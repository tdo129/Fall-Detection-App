#pragma once
#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// ── Cấu hình Firebase ─────────────────────────────────────────────
#define FIREBASE_PROJECT_ID   "doandidongtest"
#define FIREBASE_API_KEY      "AIzaSyAmFTOmaFx8nxajv0bnZ38dhh29exWnQfc"
#define FIREBASE_HOST         "firestore.googleapis.com"

/**
 * @brief Khoi tao module Firebase client. Goi mot lan sau khi Wi-Fi da
 *        co IP (wifi_manager_init_sta). Khong con PDP/APN - moi loi goi
 *        REST API tu mo ket noi HTTPS rieng qua esp_http_client.
 */
void firebase_client_init(void);

/**
 * @brief Cap nhat trang thai thiet bi len Firestore (upsert document).
 *        Path: /devices/{device_id}
 *        Kien truc moi: da bo lat/lng/gps_accuracy/ack_fall vi thiet bi
 *        khong con GPS/modem. Neu app can cac truong nay, ghi truc tiep
 *        tu phia app hoac them lai tham so khi co nguon vi tri khac.
 */
bool firebase_update_status(const char *device_id,
                             int   battery_pct,
                             bool  fall_detected,
                             float confidence);

/**
 * @brief Gui event te nga len collection fall_events.
 *        Dung Firestore serverTimestamp cho truong fall_time.
 */
bool firebase_push_fall_event(const char *device_id,
                               float confidence,
                               int   battery_pct);

/**
 * @brief Doc co emergency_mode tu Firestore (devices/{device_id}).
 *        ack_fall khong con duoc doc o firmware vi khong con duong SMS
 *        du phong de quyet dinh gui hay khong - chi app can biet ack_fall.
 */
bool firebase_get_emergency_mode(const char *device_id, bool *emergency_mode);

#ifdef __cplusplus
}
#endif
