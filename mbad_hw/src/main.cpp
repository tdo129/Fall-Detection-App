#include <cstdint>
#include <cstring>
#include <cmath>

extern "C" {
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "freertos/timers.h"
#include "freertos/event_groups.h"
#include "esp_log.h"
#include "esp_sleep.h"
#include "mpu6050.h"
#include "wifi_manager.h"
#include "firebase_client.h"
#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include <string.h>
}

#include "ai_model.h"

static const char *TAG = "FALL_MAIN";

// ── Cấu hình ──────────────────────────────────────────────────────
// KIẾN TRÚC MỚI (bỏ SIM800/EG800K): không còn GPRS/SMS/GPS. Dữ liệu
// đi thẳng lên Firestore qua Wi-Fi + HTTPS (esp_http_client). Nếu cần
// SMS cảnh báo, có thể thêm sau qua một API SMS chạy trên nền HTTP
// (Twilio, eSMS, ...), gọi từ alert_push_task bên dưới.
//
// !!! ĐỔI SSID/PASSWORD TRƯỚC KHI NẠP FIRMWARE !!!
#define WIFI_SSID                "Xom Tro"
#define WIFI_PASSWORD            "xomtro247"
#define WIFI_CONNECT_TIMEOUT_MS  (20 * 1000)

#define DEVICE_ID               "ESP32_FALL_001"
#define WINDOW_SIZE             150
#define NUM_CHANNELS            3
#define POST_FALL_SAMPLES       75       // 75 mẫu sau impact (để căn giữa window 150 mẫu)
// FIX #1: Threshold tính trên ±16g scale — 1.6g² = 2.56 g²
#define IMPACT_AM2_THRESHOLD    2.56f                   // g² (AM >= 1.6g)
#define ALERT_COOLDOWN_MS       0 // Tạm thời vô hiệu hóa (cũ: 30 * 1000)
#define SOS_BUTTON_GPIO         GPIO_NUM_27
#define BUZZER_GPIO             GPIO_NUM_4
// FIX #7: Chu kỳ báo cáo định kỳ lên Firebase (2 phút)
#define STATUS_REPORT_INTERVAL_MS  (2 * 60 * 1000)

typedef enum {
    ALERT_REASON_FALL,
    ALERT_REASON_SOS,
    ALERT_REASON_PERIODIC,
    ALERT_REASON_EMERGENCY,
    ALERT_REASON_APP_REQUEST
} alert_reason_t;

// ── Khai báo hàm ──────────────────────────────────────────────────
static void trigger_alert_async(const char *reason, float confidence, alert_reason_t type);

// ── Ring buffer ────────────────────────────────────────────────────
static float ring_buf[WINDOW_SIZE][NUM_CHANNELS];
static int   ring_head  = 0;
static int   ring_count = 0;
// FIX (race): Mutex bảo vệ ring buffer khi nhiều task truy cập
static SemaphoreHandle_t s_ring_mutex = NULL;

// ── Post-fall state ────────────────────────────────────────────────
static bool impact_detected = false;
static int  post_fall_count = 0;

// FIX #5: s_buzzer_running + spinlock bao ve viet tu nhieu task
// (buzzer_countdown_task, sos_button_task, fall_detection_task cung doc/ghi)
static portMUX_TYPE  s_buzzer_mux     = portMUX_INITIALIZER_UNLOCKED;
static volatile bool s_buzzer_running = false;

// ── FIX #5: EventGroup dong bo ket qua buzzer countdown voi fall_task
// Bit 0 = countdown xong (khong huy), Bit 1 = nguoi dung huy
#define BUZZER_DONE_BIT    (1 << 0)
#define BUZZER_CANCEL_BIT  (1 << 1)
static EventGroupHandle_t s_buzzer_eg = NULL;

// ── FIX #5: SOS button ISR flag (volatile, doc tu sos_button_task)
static volatile bool s_sos_pending = false;

// ── Trạng thái thiết bị toàn cục ──────────────────────────────────
static bool  s_current_fall_state = false;

// Cờ chế độ khẩn cấp (thay đổi từ Firebase)
static bool s_emergency_mode = false;

// ── Khai báo ADC Pin ──────────────────────────────────────────────
#define BAT_ADC_CHANNEL     ADC_CHANNEL_5   // GPIO33
#define ADC_SAMPLES         64
#define DIVIDER_RATIO       2.0f
#define BATTERY_INTERVAL_MS 60000           // 1 phút

typedef struct {
    uint16_t voltage_mv;
    uint8_t  percent;
} bat_point_t;

static const bat_point_t LOOKUP[] = {
    {4200, 100}, {4180,  99}, {4160,  98}, {4140,  97},
    {4120,  96}, {4100,  95}, {4080,  93}, {4060,  91},
    {4040,  89}, {4020,  87}, {4000,  85}, {3980,  83},
    {3960,  80}, {3940,  77}, {3920,  74}, {3900,  71},
    {3880,  68}, {3860,  65}, {3840,  62}, {3820,  59},
    {3800,  56}, {3780,  53}, {3760,  50}, {3740,  47},
    {3720,  44}, {3700,  41}, {3680,  38}, {3660,  35},
    {3640,  32}, {3620,  29}, {3600,  26}, {3580,  23},
    {3560,  20}, {3540,  17}, {3520,  15}, {3500,  13},
    {3480,  11}, {3460,   9}, {3440,   7}, {3420,   5},
    {3400,   4}, {3380,   3}, {3360,   2}, {3300,   1},
    {3000,   0},
};
#define LOOKUP_SIZE (sizeof(LOOKUP) / sizeof(LOOKUP[0]))

static adc_oneshot_unit_handle_t adc_handle;
static adc_cali_handle_t         cali_handle;
static bool                      cali_enable = false;
static int                       s_battery_pct = 100;

static void adc_init(void) {
    adc_oneshot_unit_init_cfg_t unit_cfg;
    memset(&unit_cfg, 0, sizeof(unit_cfg));
    unit_cfg.unit_id  = ADC_UNIT_1;
    unit_cfg.ulp_mode = ADC_ULP_MODE_DISABLE;
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&unit_cfg, &adc_handle));

    adc_oneshot_chan_cfg_t chan_cfg;
    memset(&chan_cfg, 0, sizeof(chan_cfg));
    chan_cfg.atten    = ADC_ATTEN_DB_12;
    chan_cfg.bitwidth = ADC_BITWIDTH_12;
    ESP_ERROR_CHECK(adc_oneshot_config_channel(
        adc_handle, BAT_ADC_CHANNEL, &chan_cfg));

#if ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED
    adc_cali_curve_fitting_config_t cali_cfg;
    memset(&cali_cfg, 0, sizeof(cali_cfg));
    cali_cfg.unit_id  = ADC_UNIT_1;
    cali_cfg.chan     = BAT_ADC_CHANNEL;
    cali_cfg.atten    = ADC_ATTEN_DB_12;
    cali_cfg.bitwidth = ADC_BITWIDTH_12;
    if (adc_cali_create_scheme_curve_fitting(&cali_cfg, &cali_handle) == ESP_OK) {
        cali_enable = true;
    }
#elif ADC_CALI_SCHEME_LINE_FITTING_SUPPORTED
    adc_cali_line_fitting_config_t cali_cfg;
    memset(&cali_cfg, 0, sizeof(cali_cfg));
    cali_cfg.unit_id   = ADC_UNIT_1;
    cali_cfg.atten     = ADC_ATTEN_DB_12;
    cali_cfg.bitwidth  = ADC_BITWIDTH_12;
    cali_cfg.default_vref = 1100;
    if (adc_cali_create_scheme_line_fitting(&cali_cfg, &cali_handle) == ESP_OK) {
        cali_enable = true;
    }
#endif
}

static uint32_t read_vbat_mv(void) {
    int32_t sum = 0;
    for (int i = 0; i < ADC_SAMPLES; i++) {
        int raw = 0;
        adc_oneshot_read(adc_handle, BAT_ADC_CHANNEL, &raw);
        sum += raw;
        vTaskDelay(pdMS_TO_TICKS(1));
    }
    int raw_avg = (int)(sum / ADC_SAMPLES);
    uint32_t vadc_mv = 0;
    if (cali_enable) {
        adc_cali_raw_to_voltage(cali_handle, raw_avg, (int*)&vadc_mv);
    } else {
        vadc_mv = (uint32_t)((float)raw_avg / 4095.0f * 3300.0f);
    }
    return (uint32_t)(vadc_mv * DIVIDER_RATIO);
}

static uint8_t voltage_to_percent(uint32_t vbat_mv) {
    if (vbat_mv >= LOOKUP[0].voltage_mv)             return 100;
    if (vbat_mv <= LOOKUP[LOOKUP_SIZE-1].voltage_mv) return 0;
    for (int i = 0; i < (int)LOOKUP_SIZE - 1; i++) {
        if (vbat_mv <= LOOKUP[i].voltage_mv &&
            vbat_mv >= LOOKUP[i+1].voltage_mv) {
            float ratio = (float)(vbat_mv             - LOOKUP[i+1].voltage_mv)
                        / (float)(LOOKUP[i].voltage_mv - LOOKUP[i+1].voltage_mv);
            return (uint8_t)(LOOKUP[i+1].percent
                   + ratio * (LOOKUP[i].percent - LOOKUP[i+1].percent));
        }
    }
    return 0;
}

static void battery_task(void* arg) {
    while (1) {
        uint32_t vbat_mv = read_vbat_mv();
        s_battery_pct = voltage_to_percent(vbat_mv);
        vTaskDelay(pdMS_TO_TICKS(BATTERY_INTERVAL_MS));
    }
}

// ── Task: Lắng nghe lệnh từ App (Firebase Polling) ─────────────
static void poll_commands_task(void *arg)
{
    (void)arg;

    // Đợi mạng và hệ thống ổn định
    vTaskDelay(pdMS_TO_TICKS(15000));

    while (1) {
        // Luôn đọc cờ emergency_mode từ Firebase
        firebase_get_emergency_mode(DEVICE_ID, &s_emergency_mode);

        bool buzzer_active;
        taskENTER_CRITICAL(&s_buzzer_mux);
        buzzer_active = s_buzzer_running;
        taskEXIT_CRITICAL(&s_buzzer_mux);

        // Bỏ qua nếu đang đếm ngược còi
        if (buzzer_active) {
            vTaskDelay(pdMS_TO_TICKS(15000));
            continue;
        }

        if (s_emergency_mode) {
            ESP_LOGW(TAG, "Emergency Mode ON! Gửi trạng thái liên tục (15s/lần)...");
            firebase_update_status(DEVICE_ID, s_battery_pct, s_current_fall_state, 1.0f);

            // Tần suất khẩn cấp: 15 giây gửi 1 lần
            vTaskDelay(pdMS_TO_TICKS(15000));
        } else {
            ESP_LOGI(TAG, "Cập nhật trạng thái định kỳ lên Firebase (2 phút/lần)...");
            firebase_update_status(DEVICE_ID, s_battery_pct, s_current_fall_state, 0.0f);

            // Ngủ STATUS_REPORT_INTERVAL_MS (hiện tại là 2 phút = 120,000 ms)
            vTaskDelay(pdMS_TO_TICKS(STATUS_REPORT_INTERVAL_MS));
        }
    }
}

// s_last_confidence: gán bởi fall_detection_task khi AI báo fall, đọc lại
// khi buzzer countdown kết thúc (không bị hủy) để đính kèm vào alert.
static float s_last_confidence = 0.0f;

// ── Build window từ ring buffer ───────────────────────────────────
static void build_window(float window[WINDOW_SIZE][NUM_CHANNELS])
{
    xSemaphoreTake(s_ring_mutex, portMAX_DELAY);
    for (int i = 0; i < WINDOW_SIZE; i++) {
        int idx = (ring_head + i) % WINDOW_SIZE;
        window[i][0] = ring_buf[idx][0];
        window[i][1] = ring_buf[idx][1];
        window[i][2] = ring_buf[idx][2];
    }
    xSemaphoreGive(s_ring_mutex);
}

// ── GPIO init ─────────────────────────────────────────────────────
static void io_init(void)
{
    // Buzzer
    gpio_config_t buzzer_cfg = {};
    buzzer_cfg.pin_bit_mask  = 1ULL << BUZZER_GPIO;
    buzzer_cfg.mode          = GPIO_MODE_OUTPUT;
    buzzer_cfg.pull_up_en    = GPIO_PULLUP_DISABLE;
    buzzer_cfg.pull_down_en  = GPIO_PULLDOWN_DISABLE;
    buzzer_cfg.intr_type     = GPIO_INTR_DISABLE;
    gpio_config(&buzzer_cfg);
    gpio_set_level(BUZZER_GPIO, 0);

    // FIX #5: SOS button dùng External Interrupt + wakeup source
    // Không còn polling — ISR set flag, task xử lý
    gpio_config_t btn_cfg = {};
    btn_cfg.pin_bit_mask = 1ULL << SOS_BUTTON_GPIO;
    btn_cfg.mode         = GPIO_MODE_INPUT;
    btn_cfg.pull_up_en   = GPIO_PULLUP_ENABLE;
    btn_cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
    btn_cfg.intr_type    = GPIO_INTR_NEGEDGE;   // Ngắt cạnh xuống (nút nhấn)
    gpio_config(&btn_cfg);

    // Cho phép GPIO25 đánh thức ESP32 từ Light Sleep
    esp_sleep_enable_ext1_wakeup(1ULL << SOS_BUTTON_GPIO, ESP_EXT1_WAKEUP_ALL_LOW);
}

// ── FIX #5: SOS button ISR — chỉ set flag, không làm gì nặng trong ISR
static void IRAM_ATTR sos_isr_handler(void *arg)
{
    (void)arg;
    s_sos_pending = true;
}

static bool button_pressed(void)
{
    if (gpio_get_level(SOS_BUTTON_GPIO) == 0) {
        vTaskDelay(pdMS_TO_TICKS(50));  // debounce
        return gpio_get_level(SOS_BUTTON_GPIO) == 0;
    }
    return false;
}

// ── Buzzer countdown task ─────────────────────────────────────────
// FIX #5: Chạy trong task riêng để fall_detection_task không bị block 5s.
// Kết quả được báo qua EventGroup.
typedef struct {
    EventGroupHandle_t eg;
} buzzer_task_arg_t;

static void buzzer_countdown_task(void *arg)
{
    buzzer_task_arg_t *a = (buzzer_task_arg_t *)arg;
    // Lưu eg vào biến cục bộ TRƯỚC khi free(arg) để tránh use-after-free
    EventGroupHandle_t eg = a->eg;
    free(arg);

    gpio_set_level(BUZZER_GPIO, 1);

    for (int i = 0; i < 50; i++) {   // 50 x 100ms = 5 giay
        if (button_pressed()) {
            gpio_set_level(BUZZER_GPIO, 0);
            // Cho tha nut
            TickType_t release_start = xTaskGetTickCount();
            while (button_pressed()) {
                vTaskDelay(pdMS_TO_TICKS(50));
                if (xTaskGetTickCount() - release_start > pdMS_TO_TICKS(2000)) {
                    ESP_LOGE(TAG, "Button stuck pressed >2s — forcing release, check wiring/GPIO%d", SOS_BUTTON_GPIO);
                    break;
                }
            }
            ESP_LOGW(TAG, "Canh bao bi huy boi nut nhan");
            // FIX: reset s_buzzer_running trong cancel path —
            // tránh stuck true mãi mãi khi countdown bị hủy giữa chừng
            taskENTER_CRITICAL(&s_buzzer_mux);
            s_buzzer_running = false;
            taskEXIT_CRITICAL(&s_buzzer_mux);
            xEventGroupSetBits(eg, BUZZER_CANCEL_BIT);
            vTaskDelete(NULL);
            return;
        }
        vTaskDelay(pdMS_TO_TICKS(100));
    }

    gpio_set_level(BUZZER_GPIO, 0);
    xEventGroupSetBits(eg, BUZZER_DONE_BIT);  // bao hieu fall_detection_task can gui alert
    taskENTER_CRITICAL(&s_buzzer_mux);         // FIX #5: spinlock bao ve s_buzzer_running
    s_buzzer_running = false;
    taskEXIT_CRITICAL(&s_buzzer_mux);
    vTaskDelete(NULL);
}

// FIX #5: Khoi dong buzzer countdown task + spinlock bao ve s_buzzer_running
static EventGroupHandle_t start_buzzer_countdown(void)
{
    taskENTER_CRITICAL(&s_buzzer_mux);
    s_buzzer_running = true;
    taskEXIT_CRITICAL(&s_buzzer_mux);

    buzzer_task_arg_t *arg = (buzzer_task_arg_t *)malloc(sizeof(buzzer_task_arg_t));
    if (!arg) {
        taskENTER_CRITICAL(&s_buzzer_mux);
        s_buzzer_running = false;
        taskEXIT_CRITICAL(&s_buzzer_mux);
        return NULL;
    }
    arg->eg = s_buzzer_eg;
    xEventGroupClearBits(s_buzzer_eg, BUZZER_DONE_BIT | BUZZER_CANCEL_BIT);
    xTaskCreate(buzzer_countdown_task, "buzzer_cd", 2048, arg, 6, NULL);
    return s_buzzer_eg;
}

// ── KIẾN TRÚC MỚI: gửi cảnh báo lên Firestore qua Wi-Fi ───────────
// Trước đây (bản SIM): phải chờ GPS fix chạy nền rồi mới POST, và nếu
// Firestore POST thất bại hoặc app không ACK sau 20s thì gửi SMS dự
// phòng qua modem. Không còn modem/GPS nên đơn giản hoá: một task
// ngắn hạn POST thẳng lên Firestore qua Wi-Fi (nhanh hơn AT-command
// nhiều), có thử lại 1 lần nếu POST đầu thất bại. Không còn SMS dự
// phòng — nếu cần một kênh dự phòng ngoài Wi-Fi, cân nhắc thêm module
// LTE/SIM rời hoặc dịch vụ SMS API (Twilio/eSMS) gọi qua HTTP tại đây.
typedef struct {
    float          confidence;
    alert_reason_t reason;
} alert_push_arg_t;

static void alert_push_task(void *arg)
{
    alert_push_arg_t *a = (alert_push_arg_t *)arg;
    float          confidence = a->confidence;
    alert_reason_t reason     = a->reason;
    free(a);

    bool is_fall_or_sos = (reason == ALERT_REASON_FALL || reason == ALERT_REASON_SOS);

    if (is_fall_or_sos) {
        s_current_fall_state = true;
        bool fall_ok   = firebase_push_fall_event(DEVICE_ID, confidence, s_battery_pct);
        bool status_ok = firebase_update_status(DEVICE_ID, s_battery_pct, true, confidence);

        if (!fall_ok || !status_ok) {
            ESP_LOGW(TAG, "Firestore push thất bại — thử lại sau 3s (Wi-Fi có thể vừa rớt)...");
            vTaskDelay(pdMS_TO_TICKS(3000));
            firebase_push_fall_event(DEVICE_ID, confidence, s_battery_pct);
            firebase_update_status(DEVICE_ID, s_battery_pct, true, confidence);
        }
    } else {
        firebase_update_status(DEVICE_ID, s_battery_pct, s_current_fall_state, confidence);
    }

    vTaskDelete(NULL);
}

static void trigger_alert_async(const char *reason, float confidence, alert_reason_t type)
{
    ESP_LOGW(TAG, "Trigger alert: %s (conf=%.2f)", reason, confidence);

    alert_push_arg_t *arg = (alert_push_arg_t *)malloc(sizeof(alert_push_arg_t));
    if (!arg) {
        ESP_LOGE(TAG, "malloc thất bại — bỏ qua alert");
        return;
    }
    arg->confidence = confidence;
    arg->reason     = type;
    xTaskCreate(alert_push_task, "alert_push", 8192, arg, 4, NULL);
}

// ── KIẾN TRÚC MỚI: Init Wi-Fi + Firebase (thay cho init SIM/PDP) ──
static bool init_wifi_and_firebase(void)
{
    esp_err_t err = wifi_manager_init_sta(WIFI_SSID, WIFI_PASSWORD, WIFI_CONNECT_TIMEOUT_MS);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Wi-Fi chưa có IP sau %d ms lúc khởi động — vẫn tiếp tục, "
                       "wifi_manager sẽ tự kết nối lại ở nền", WIFI_CONNECT_TIMEOUT_MS);
    }
    firebase_client_init();
    return (err == ESP_OK);
}

// ── Fall detection task (core 1) ──────────────────────────────────
// FIX #3: Chạy trên core 1. Light sleep (nếu dùng) chỉ ảnh hưởng core 1.
// sos_button_task chạy trên core 0 — không bị ảnh hưởng.
static void fall_detection_task(void *arg)
{
    (void)arg;

    i2c_master_bus_handle_t bus_handle;
    ESP_ERROR_CHECK(i2c_master_init(&bus_handle));
    ESP_ERROR_CHECK(mpu6050_init(bus_handle));
    ESP_ERROR_CHECK(ai_model_init());

    bool setup_ok = init_wifi_and_firebase();

    // Gửi trạng thái khởi động lên Firestore
    s_current_fall_state = false;
    firebase_update_status(DEVICE_ID, s_battery_pct, false, 0.0f);

    vTaskDelay(pdMS_TO_TICKS(2000));

    ESP_LOGI(TAG, "=== Light Sleep mode: wakeup từ MPU6050 INT (GPIO%d) ===",
             MPU6050_INT_GPIO);

    TickType_t last_alert = xTaskGetTickCount() - pdMS_TO_TICKS(ALERT_COOLDOWN_MS);
    EventGroupHandle_t active_buzzer_eg = NULL;
    s_last_confidence = 0.0f;

    // Buffer đọc FIFO — tối đa 170 mẫu (1024 byte / 6 byte)
    static mpu6050_data_t fifo_samples[170];

    // Còi kêu 1 lần báo hệ thống sẵn sàng — chỉ khi Wi-Fi đã lên
    if (setup_ok) {
        ESP_LOGI(TAG, "=== HỆ THỐNG SẴN SÀNG ===");
        gpio_set_level(BUZZER_GPIO, 1);
        vTaskDelay(pdMS_TO_TICKS(200));
        gpio_set_level(BUZZER_GPIO, 0);
    } else {
        ESP_LOGW(TAG, "Setup chưa hoàn tất (Wi-Fi lỗi) — không bật còi báo sẵn sàng");
    }

    while (1) {
        // ── Vào Light Sleep, thức khi MPU6050 báo FIFO gần đầy ──────
        // configure_light_sleep_wakeup đã set trong mpu6050_init()
        // Timer wakeup 4.5s làm backup phòng INT không kéo
        esp_sleep_enable_ext0_wakeup(MPU6050_INT_GPIO, 1);
    esp_sleep_enable_ext1_wakeup(1ULL << SOS_BUTTON_GPIO, ESP_EXT1_WAKEUP_ALL_LOW);
    esp_sleep_enable_timer_wakeup(4500 * 1000ULL);

    if (s_buzzer_running) {
        vTaskDelay(pdMS_TO_TICKS(100));
        continue;
    }
        //esp_light_sleep_start();

        // ── Thức dậy — lý do thức ────────────────────────────────────
        esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
        if (cause == ESP_SLEEP_WAKEUP_EXT0) {
            ESP_LOGD(TAG, "Wakeup: MPU FIFO INT");
        } else if (cause == ESP_SLEEP_WAKEUP_TIMER) {
            ESP_LOGD(TAG, "Wakeup: timer backup");
        }

        // ── Kiểm tra buzzer đang chạy không ─────────────────────────
        if (active_buzzer_eg != NULL) {
            EventBits_t bits = xEventGroupGetBits(active_buzzer_eg);
            if (bits & BUZZER_CANCEL_BIT) {
                // Người dùng hủy cảnh báo — cập nhật Firestore về bình thường
                active_buzzer_eg = NULL;
                s_current_fall_state = false;
                firebase_update_status(DEVICE_ID, s_battery_pct, false, 0.0f);
            } else if (bits & BUZZER_DONE_BIT) {
                active_buzzer_eg = NULL;
                trigger_alert_async("FALL DETECTED", s_last_confidence, ALERT_REASON_FALL);
            }
        }

        // ── Lấy mẫu (Polling 25Hz giống wireless_test) ─────────────
        mpu6050_clear_interrupt();

        mpu6050_data_t imu_data;
        if (mpu6050_read(&imu_data) != ESP_OK) {
            vTaskDelay(pdMS_TO_TICKS(40));
            continue;
        }

        mpu6050_data_t *imu = &imu_data;

        // Nạp vào ring buffer (đổi trục khớp dataset)
        xSemaphoreTake(s_ring_mutex, portMAX_DELAY);
        ring_buf[ring_head][0] = imu->ax_g;
        ring_buf[ring_head][1] = imu->ay_g;
        ring_buf[ring_head][2] = imu->az_g;
        ring_head = (ring_head + 1) % WINDOW_SIZE;
        if (ring_count < WINDOW_SIZE) ring_count++;
        xSemaphoreGive(s_ring_mutex);

        float am2 = imu->ax_g * imu->ax_g +
                    imu->ay_g * imu->ay_g +
                    imu->az_g * imu->az_g;

        // Impact detection
        if (!impact_detected &&
            am2 > IMPACT_AM2_THRESHOLD &&
            ring_count >= POST_FALL_SAMPLES) {
            impact_detected = true;
            post_fall_count = 0;
            ESP_LOGW(TAG, "Impact! AM2=%.3f", am2);
        }

        if (impact_detected) {
            if (++post_fall_count >= POST_FALL_SAMPLES && ring_count >= WINDOW_SIZE) {
                float window[WINDOW_SIZE][NUM_CHANNELS];
                build_window(window);
                impact_detected = false;

                ai_result_t res;
                if (ai_model_run(window, &res) == ESP_OK) {
                    ESP_LOGI(TAG, "AI: fall=%d conf=%.3f", res.is_fall, res.confidence);

                    if (res.is_fall && res.confidence >= 0.50f) {
                        TickType_t now = xTaskGetTickCount();
                        if ((now - last_alert) >= pdMS_TO_TICKS(ALERT_COOLDOWN_MS)) {
                            last_alert = now;
                            s_last_confidence = res.confidence;
                            active_buzzer_eg  = start_buzzer_countdown();
                        } else {
                            ESP_LOGW(TAG, "Cooldown chưa hết");
                        }
                    } else if (res.is_fall) {
                        ESP_LOGW(TAG, "Fall detected nhưng confidence %.1f%% < 50%% — bỏ qua",
                            res.confidence * 100.0f);
                    }
                }
            }
        }

        vTaskDelay(pdMS_TO_TICKS(40)); // ~25Hz
    }
}
// ── SOS button task (core 0) ──────────────────────────────────────
// FIX #5: Dùng ISR flag thay vì polling.
// Task chờ flag từ ISR, xử lý debounce, rồi trigger alert.
static void sos_button_task(void *arg)
{
    (void)arg;

    while (1) {
        vTaskDelay(pdMS_TO_TICKS(50));

        if (!s_sos_pending) continue;
        s_sos_pending = false;

        // FIX: Nếu buzzer countdown đang chạy, lần bấm này dùng để HỦY còi
        // chứ không phải kích SOS — bỏ qua để tránh kích hoạt SOS sai
        bool buzzer_was_running;
        taskENTER_CRITICAL(&s_buzzer_mux);
        buzzer_was_running = s_buzzer_running;
        taskEXIT_CRITICAL(&s_buzzer_mux);
        if (buzzer_was_running) {
            ESP_LOGI(TAG, "Nút nhấn đã dùng để hủy còi té ngã — bỏ qua SOS");
            continue;
        }

        vTaskDelay(pdMS_TO_TICKS(50));
        if (!button_pressed()) continue;

        ESP_LOGW(TAG, "SOS thủ công được nhấn");

            TickType_t release_start = xTaskGetTickCount();
            while (button_pressed()) {
                vTaskDelay(pdMS_TO_TICKS(50));
                if (xTaskGetTickCount() - release_start > pdMS_TO_TICKS(2000)) {
                    ESP_LOGE(TAG, "Button stuck pressed >2s — forcing release, check wiring/GPIO%d", SOS_BUTTON_GPIO);
                    break;
                }
            }
        vTaskDelay(pdMS_TO_TICKS(300));

        s_buzzer_running = true;
        gpio_set_level(BUZZER_GPIO, 1);

        // FIX: Dùng timestamp thay vì vòng for đếm — chính xác hơn
        // không bị ảnh hưởng bởi preemption hay delay bên ngoài
        bool cancelled = false;
        TickType_t sos_start = xTaskGetTickCount();

        while (xTaskGetTickCount() - sos_start < pdMS_TO_TICKS(5000)) {
            if (button_pressed()) {
                TickType_t release_start = xTaskGetTickCount();
                while (button_pressed()) {
                    vTaskDelay(pdMS_TO_TICKS(50));
                    if (xTaskGetTickCount() - release_start > pdMS_TO_TICKS(2000)) {
                        ESP_LOGE(TAG, "Button stuck pressed >2s — forcing release, check wiring/GPIO%d", SOS_BUTTON_GPIO);
                        break;
                    }
                }
                ESP_LOGW(TAG, "SOS hủy bởi người dùng");
                cancelled = true;
                break;
            }
            vTaskDelay(pdMS_TO_TICKS(20));  // poll nhanh hơn — 20ms thay vì 100ms
        }

        gpio_set_level(BUZZER_GPIO, 0);
        taskENTER_CRITICAL(&s_buzzer_mux);  // FIX #5
        s_buzzer_running = false;
        taskEXIT_CRITICAL(&s_buzzer_mux);

        if (cancelled) {
            vTaskDelay(pdMS_TO_TICKS(200));
            s_current_fall_state = false;
            firebase_update_status(DEVICE_ID, s_battery_pct, false, 0.0f);
        } else {
            trigger_alert_async("MANUAL SOS", 1.0f, ALERT_REASON_SOS);
        }
    }
}

// ── App main ──────────────────────────────────────────────────────
extern "C" void app_main(void)
{
    // Khởi tạo GPIO sớm nhất (buzzer + button config)
    io_init();

    // Khởi tạo ADC và tạo Task đo pin
    adc_init();
    xTaskCreate(battery_task, "battery_task", 4096, NULL, 4, NULL);

    // FIX LỖI 2: Đăng ký ISR service và handler tại đây — chỉ gọi một lần
    // toàn hệ thống. Không gọi lại trong bất kỳ task nào.
    ESP_ERROR_CHECK(gpio_install_isr_service(0));
    ESP_ERROR_CHECK(gpio_isr_handler_add(SOS_BUTTON_GPIO, sos_isr_handler, NULL));

    // Khởi tạo FreeRTOS primitives
    s_ring_mutex = xSemaphoreCreateMutex();
    configASSERT(s_ring_mutex);

    s_buzzer_eg = xEventGroupCreate();
    configASSERT(s_buzzer_eg);

    // Khởi chạy task lắng nghe lệnh từ App — tăng stack lên 8192 để chứa resp[2048]
    xTaskCreatePinnedToCore(poll_commands_task, "poll_cmd",
                            8192, NULL, 4, NULL, 0);

    // FIX #3: fall_detection_task pin vào core 1
    xTaskCreatePinnedToCore(fall_detection_task, "fall_det",
                            16384, NULL, 5, NULL, 1);

    // FIX #5: sos_button_task trên core 0
    xTaskCreatePinnedToCore(sos_button_task, "sos_btn",
                            4096, NULL, 7, NULL, 0);
}
