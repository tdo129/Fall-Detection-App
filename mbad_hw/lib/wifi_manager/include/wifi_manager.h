#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// ── Wi-Fi station manager ────────────────────────────────────────
// Thay thế hoàn toàn module SIM (EG800K) làm đường truyền dữ liệu.
// Không còn GPRS/APN — thiết bị dùng Wi-Fi nội bộ để gọi Firestore
// REST API qua HTTPS (xem lib/firebase_client).

/**
 * @brief Khởi tạo NVS + netif + Wi-Fi station, kết nối tới AP và CHỜ
 *        (blocking) cho tới khi có IP hoặc hết timeout.
 *        Tự động reconnect khi mất kết nối (chạy nền, không cần gọi lại).
 *
 * @param ssid       Tên Wi-Fi (2.4GHz — ESP32 cổ điển không hỗ trợ 5GHz)
 * @param password   Mật khẩu Wi-Fi (chuỗi rỗng "" nếu mạng mở)
 * @param timeout_ms Thời gian tối đa chờ có IP lần đầu
 * @return ESP_OK nếu đã có IP trước khi timeout, ESP_ERR_TIMEOUT nếu không.
 *         Dù trả về timeout, Wi-Fi vẫn tiếp tục tự retry ở nền.
 */
esp_err_t wifi_manager_init_sta(const char *ssid, const char *password, uint32_t timeout_ms);

/**
 * @brief Có đang có IP (đã kết nối) hay không — dùng để bỏ qua các lần
 *        gọi Firestore khi rõ ràng đang mất mạng, tránh chờ timeout HTTP vô ích.
 */
bool wifi_manager_is_connected(void);

#ifdef __cplusplus
}
#endif
