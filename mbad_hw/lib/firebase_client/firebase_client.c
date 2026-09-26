#include "firebase_client.h"

#include <stdio.h>
#include <string.h>

#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "esp_log.h"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "FIREBASE";

#define FB_RESP_BUF_SIZE    2048
#define FB_HTTP_TIMEOUT_MS  10000

// URL cố định cho endpoint "commit" (dùng chung cho update_status và push_fall_event)
#define COMMIT_URL \
    "https://" FIREBASE_HOST "/v1/projects/" FIREBASE_PROJECT_ID \
    "/databases/(default)/documents:commit?key=" FIREBASE_API_KEY

// Format cho GET một document theo device_id (t=... để tránh cache)
#define DEVICE_DOC_URL_FMT \
    "https://" FIREBASE_HOST "/v1/projects/" FIREBASE_PROJECT_ID \
    "/databases/(default)/documents/devices/%s?key=" FIREBASE_API_KEY "&t=%ld"

typedef struct {
    char  *buf;
    size_t buf_size;
    size_t len;
} fb_resp_ctx_t;

// Gom các đoạn HTTP_EVENT_ON_DATA vào một buffer — dùng cho GET.
static esp_err_t fb_http_event_handler(esp_http_client_event_t *evt)
{
    fb_resp_ctx_t *ctx = (fb_resp_ctx_t *)evt->user_data;
    if (evt->event_id == HTTP_EVENT_ON_DATA && ctx && ctx->buf) {
        if (ctx->len + 1 < ctx->buf_size) {
            size_t space = ctx->buf_size - ctx->len - 1;
            size_t n = (size_t)evt->data_len < space ? (size_t)evt->data_len : space;
            memcpy(ctx->buf + ctx->len, evt->data, n);
            ctx->len += n;
            ctx->buf[ctx->len] = '\0';
        }
    }
    return ESP_OK;
}

// POST JSON body tới một URL Firestore cố định. Trả true nếu HTTP 200.
static bool fb_http_post_json(const char *url, const char *body)
{
    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = FB_HTTP_TIMEOUT_MS,
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        ESP_LOGE(TAG, "esp_http_client_init thất bại (POST)");
        return false;
    }

    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, body, strlen(body));

    esp_err_t err = esp_http_client_perform(client);
    bool ok = false;
    if (err == ESP_OK) {
        int status = esp_http_client_get_status_code(client);
        ok = (status == 200);
        if (ok) {
            ESP_LOGI(TAG, "Firestore POST OK (HTTP 200)");
        } else {
            ESP_LOGE(TAG, "Firestore POST thất bại, HTTP %d", status);
        }
    } else {
        ESP_LOGE(TAG, "Firestore POST lỗi mạng: %s", esp_err_to_name(err));
    }
    esp_http_client_cleanup(client);
    return ok;
}

// GET một document Firestore, ghi phần body JSON vào resp_buf.
static bool fb_http_get_json(const char *url, char *resp_buf, size_t resp_size)
{
    fb_resp_ctx_t ctx = { .buf = resp_buf, .buf_size = resp_size, .len = 0 };
    if (resp_buf && resp_size) resp_buf[0] = '\0';

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_GET,
        .timeout_ms = FB_HTTP_TIMEOUT_MS,
        .event_handler = fb_http_event_handler,
        .user_data = &ctx,
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        ESP_LOGE(TAG, "esp_http_client_init thất bại (GET)");
        return false;
    }

    esp_err_t err = esp_http_client_perform(client);
    bool ok = false;
    if (err == ESP_OK) {
        int status = esp_http_client_get_status_code(client);
        ok = (status == 200);
        if (!ok) ESP_LOGW(TAG, "Firestore GET thất bại/không tìm thấy, HTTP %d", status);
    } else {
        ESP_LOGE(TAG, "Firestore GET lỗi mạng: %s", esp_err_to_name(err));
    }
    esp_http_client_cleanup(client);
    return ok;
}

// ── Public API ────────────────────────────────────────────────────

void firebase_client_init(void)
{
    ESP_LOGI(TAG, "Firebase client sẵn sàng (HTTPS qua Wi-Fi, esp_http_client)");
}

bool firebase_update_status(const char *device_id,
                             int   battery_pct,
                             bool  fall_detected,
                             float confidence)
{
    const char *dev = device_id ? device_id : "ESP32_FALL_001";

    char doc_name[128];
    snprintf(doc_name, sizeof(doc_name),
             "projects/" FIREBASE_PROJECT_ID
             "/databases/(default)/documents/devices/%s", dev);

    char body[512];
    snprintf(body, sizeof(body),
        "{\"writes\":[{\"update\":{\"name\":\"%s\",\"fields\":{"
            "\"device_id\":{\"stringValue\":\"%s\"},"
            "\"battery_pct\":{\"integerValue\":\"%d\"},"
            "\"fall_detected\":{\"booleanValue\":%s},"
            "\"confidence\":{\"doubleValue\":%.4f}"
        "}},\"updateMask\":{\"fieldPaths\":[\"device_id\",\"battery_pct\",\"fall_detected\",\"confidence\"]}}]}",
        doc_name, dev, battery_pct,
        fall_detected ? "true" : "false",
        (double)confidence);

    ESP_LOGI(TAG, "Cập nhật trạng thái lên Firestore (battery=%d%%, fall=%d, conf=%.2f)...",
             battery_pct, fall_detected, (double)confidence);
    return fb_http_post_json(COMMIT_URL, body);
}

bool firebase_push_fall_event(const char *device_id,
                               float confidence,
                               int   battery_pct)
{
    uint32_t r1 = esp_random();
    uint32_t r2 = esp_random();
    char doc_id[64];
    snprintf(doc_id, sizeof(doc_id), "evt_%08lx%08lx", (unsigned long)r1, (unsigned long)r2);

    const char *dev = device_id ? device_id : "ESP32_FALL_001";

    char body[512];
    snprintf(body, sizeof(body),
        "{\"writes\":[{"
            "\"update\":{"
                "\"name\":\"projects/" FIREBASE_PROJECT_ID "/databases/(default)/documents/fall_events/%s\","
                "\"fields\":{"
                    "\"device_id\":{\"stringValue\":\"%s\"},"
                    "\"confidence\":{\"doubleValue\":%.4f},"
                    "\"battery_at_event\":{\"integerValue\":\"%d\"}"
                "}"
            "},"
            "\"updateTransforms\":[{"
                "\"fieldPath\":\"fall_time\","
                "\"setToServerValue\":\"REQUEST_TIME\""
            "}]"
        "}]}",
        doc_id, dev, (double)confidence, battery_pct);

    ESP_LOGI(TAG, "Đẩy fall_event lên Firestore (serverTimestamp)...");
    return fb_http_post_json(COMMIT_URL, body);
}

bool firebase_get_emergency_mode(const char *device_id, bool *emergency_mode)
{
    if (!emergency_mode) return false;
    const char *dev = device_id ? device_id : "ESP32_FALL_001";

    char url[256];
    snprintf(url, sizeof(url), DEVICE_DOC_URL_FMT, dev, (long)xTaskGetTickCount());

    char resp[FB_RESP_BUF_SIZE];
    if (!fb_http_get_json(url, resp, sizeof(resp))) return false;

    char *loc = strstr(resp, "\"emergency_mode\"");
    if (!loc) {
        *emergency_mode = false;
        return true;
    }

    char window[256];
    strncpy(window, loc, sizeof(window) - 1);
    window[sizeof(window) - 1] = '\0';

    char *true_ptr  = strstr(window, "true");
    char *false_ptr = strstr(window, "false");
    *emergency_mode = (true_ptr && (!false_ptr || true_ptr < false_ptr));
    return true;
}
