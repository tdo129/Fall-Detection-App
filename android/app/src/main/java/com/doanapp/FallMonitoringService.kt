package com.doanapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

class FallMonitoringService : Service() {

    companion object {
        private const val TAG = "FallMonitoringService"
        const val CHANNEL_MONITORING_ID = "fall_monitoring_channel"
        const val CHANNEL_ALERT_ID = "fall_alert_channel"
        const val NOTIFICATION_ID_SERVICE = 1001
        const val NOTIFICATION_ID_ALERT = 1002

        const val ACTION_START = "com.doanapp.ACTION_START_MONITORING"
        const val ACTION_STOP = "com.doanapp.ACTION_STOP_MONITORING"
        const val ACTION_SYNC_DEVICES = "com.doanapp.ACTION_SYNC_DEVICES"
        const val ACTION_START_ALARM = "com.doanapp.ACTION_START_ALARM"
        const val ACTION_STOP_ALARM = "com.doanapp.ACTION_STOP_ALARM"
        const val ACTION_DISMISS_NOTIFICATIONS = "com.doanapp.ACTION_DISMISS_NOTIFICATIONS"
        const val EXTRA_DEVICE_ID = "deviceId"

        private const val PREFS_NAME = "CareDropBackground"
        private const val KEY_ALLOWED_DEVICE_IDS = "allowed_device_ids"
        private const val KEY_DEVICE_ID = "device_id"
    }

    private val activeListeners = ConcurrentHashMap<String, ListenerRegistration>()
    private var userListener: ListenerRegistration? = null
    private var currentListeningEmail: String? = null
    private lateinit var prefs: SharedPreferences

    // ─── Alarm state ──────────────────────────────────────────────────────────
    private var alarmMediaPlayer: MediaPlayer? = null
    private var alarmVibrator: Vibrator? = null
    private var alarmVibratorManager: VibratorManager? = null

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "onCreate: Initializing FallMonitoringService")
        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        createNotificationChannels()
        startForegroundWithNotification()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        Log.d(TAG, "onStartCommand: action=$action")

        if (action == ACTION_STOP) {
            stopMonitoring()
            stopSelf()
            return START_NOT_STICKY
        }

        // Phát âm thanh/rung báo động (như chuông báo thức) VÀ hiển thị thông báo té ngã khẩn cấp
        if (action == ACTION_START_ALARM) {
            Log.d(TAG, "Starting alarm sound, vibration and notification from JS")
            val rawAllowed = prefs.getStringSet(KEY_ALLOWED_DEVICE_IDS, null)
            val devId = intent?.getStringExtra("deviceId")
                ?: rawAllowed?.firstOrNull { it.isNotBlank() }
                ?: "ESP32"
            val devName = intent?.getStringExtra("deviceName") ?: devId
            val fallTime = intent?.getStringExtra("fallTime") ?: ""
            val lat = intent?.getDoubleExtra("latitude", 10.852302) ?: 10.852302
            val lng = intent?.getDoubleExtra("longitude", 106.773779) ?: 106.773779
            val batteryPct = intent?.getIntExtra("batteryPct", 100) ?: 100

            triggerFallAlertNotification(devId, devName, fallTime, lat, lng, batteryPct)
            return START_NOT_STICKY
        }

        // Dừng âm thanh/rung khi người dùng nhấn tắt chuông
        if (action == ACTION_STOP_ALARM) {
            Log.d(TAG, "Stopping alarm sound and vibration")
            stopAlarm()
            return START_NOT_STICKY
        }

        // Hủy thông báo khi người dùng nhấn "Đã kiểm tra — Tắt cảnh báo" trong app
        if (action == ACTION_DISMISS_NOTIFICATIONS) {
            Log.d(TAG, "Dismissing alert notifications and clearing fall flags")
            stopAlarm()
            dismissAlertNotifications()
            try {
                val rawAllowed = prefs.getStringSet(KEY_ALLOWED_DEVICE_IDS, mutableSetOf()) ?: mutableSetOf()
                val db = FirebaseFirestore.getInstance()
                val updates = mapOf<String, Any>(
                    "fall_detected" to false,
                    "ack_fall" to true
                )
                for (devId in rawAllowed) {
                    val cleanId = devId.trim()
                    if (cleanId.isNotEmpty()) {
                        prefs.edit().putBoolean("last_fall_detected_$cleanId", false).apply()
                        db.collection("devices").document(cleanId).update(updates)
                            .addOnFailureListener {
                                db.collection("devices").document(cleanId).set(updates, com.google.firebase.firestore.SetOptions.merge())
                            }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error resetting fall flags in service", e)
            }
            return START_NOT_STICKY
        }

        // Lấy deviceId thêm từ intent nếu có
        val extraId = intent?.getStringExtra(EXTRA_DEVICE_ID)
        if (!extraId.isNullOrEmpty()) {
            val currentSet = prefs.getStringSet(KEY_ALLOWED_DEVICE_IDS, mutableSetOf()) ?: mutableSetOf()
            val newSet = HashSet(currentSet)
            newSet.add(extraId.trim())
            newSet.add(extraId.trim().uppercase())
            prefs.edit().putStringSet(KEY_ALLOWED_DEVICE_IDS, newSet).apply()
        }

        // Đồng bộ và lắng nghe tất cả các thiết bị được cấp phép
        syncAndStartListeners()

        return START_STICKY
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            // 1. Channel thông báo chạy ngầm thường trực (im lặng)
            val monitoringChannel = NotificationChannel(
                CHANNEL_MONITORING_ID,
                "Dịch vụ bảo vệ CareDrop",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Hiển thị trạng thái đang giám sát an toàn trong nền"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_SECRET
            }
            notificationManager.createNotificationChannel(monitoringChannel)

            // 2. Channel cảnh báo té ngã khẩn cấp (âm thanh lớn + rung mạnh)
            val alarmSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            val audioAttributes = AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_ALARM)
                .build()

            val alertChannel = NotificationChannel(
                CHANNEL_ALERT_ID,
                "Cảnh báo té ngã khẩn cấp",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Phát chuông và rung cảnh báo khi phát hiện sự kiện té ngã"
                enableLights(true)
                lightColor = 0xFFFF0000.toInt()
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 800, 400, 800, 400, 800, 400, 800)
                setSound(alarmSoundUri, audioAttributes)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                setBypassDnd(true)
            }
            notificationManager.createNotificationChannel(alertChannel)
        }
    }

    private fun startForegroundWithNotification() {
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_MONITORING_ID)
            .setContentTitle("CareDrop đang bảo vệ")
            .setContentText("Hệ thống giám sát té ngã đang hoạt động trong nền 24/7")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID_SERVICE,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                )
            } else {
                startForeground(NOTIFICATION_ID_SERVICE, notification)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in startForeground (dataSync): ${e.message}", e)
            try {
                startForeground(NOTIFICATION_ID_SERVICE, notification)
            } catch (e2: Exception) {
                Log.e(TAG, "Fallback startForeground also failed: ${e2.message}", e2)
            }
        }
    }

    /**
     * Đồng bộ danh sách thiết bị được phép kêu và bắt đầu lắng nghe Firestore
     */
    private fun syncAndStartListeners() {
        // 1. Nếu có user_email, lắng nghe tài khoản để tự động cập nhật danh sách pairedDevices/espId từ Firestore
        val userEmail = prefs.getString("user_email", null)?.trim()?.lowercase()
        if (currentListeningEmail != userEmail) {
            userListener?.remove()
            userListener = null
            currentListeningEmail = userEmail
        }

        if (!userEmail.isNullOrEmpty() && userListener == null) {
            try {
                Log.d(TAG, "Attaching Firestore listener for user: $userEmail")
                val db = FirebaseFirestore.getInstance()
                userListener = db.collection("users").document(userEmail)
                    .addSnapshotListener { snapshot, error ->
                        if (error != null) {
                            Log.w(TAG, "Error listening to user $userEmail: ${error.message}")
                            return@addSnapshotListener
                        }
                        if (snapshot != null && snapshot.exists()) {
                            val newIds = HashSet<String>()
                            val rawList = snapshot.get("pairedDevices") as? List<*>
                            if (rawList != null) {
                                for (item in rawList) {
                                    if (item is Map<*, *>) {
                                        val id = item["id"] as? String
                                        if (!id.isNullOrBlank()) {
                                            newIds.add(id.trim())
                                            newIds.add(id.trim().uppercase())
                                        }
                                    } else if (item is String && item.isNotBlank()) {
                                        newIds.add(item.trim())
                                        newIds.add(item.trim().uppercase())
                                    }
                                }
                            }
                            val espId = (snapshot.getString("espId") ?: snapshot.getString("deviceId"))?.trim()
                            if (!espId.isNullOrEmpty()) {
                                newIds.add(espId)
                                newIds.add(espId.uppercase())
                            }
                            if (newIds.isNotEmpty()) {
                                Log.d(TAG, "Auto-synced devices from Firestore user document: $newIds")
                                val existing = prefs.getStringSet(KEY_ALLOWED_DEVICE_IDS, mutableSetOf()) ?: mutableSetOf()
                                val combined = HashSet(existing)
                                combined.addAll(newIds)
                                prefs.edit().putStringSet(KEY_ALLOWED_DEVICE_IDS, combined).apply()
                                syncDeviceListeners()
                            }
                        }
                    }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to listen to user document $userEmail", e)
            }
        }

        syncDeviceListeners()
    }

    private fun syncDeviceListeners() {
        val rawAllowed = prefs.getStringSet(KEY_ALLOWED_DEVICE_IDS, null) ?: emptySet()
        val normalizedAllowed = rawAllowed.map { it.trim().uppercase() }.filter { it.isNotEmpty() }.toSet()
        Log.d(TAG, "syncDeviceListeners: Normalized allowed IDs = $normalizedAllowed")

        // 1. Hủy listener của những thiết bị không còn được phép hoặc bị xóa
        val toRemove = activeListeners.keys.filter { !normalizedAllowed.contains(it.uppercase()) }
        for (id in toRemove) {
            Log.d(TAG, "Removing listener for unlinked/disabled device: $id")
            activeListeners[id]?.remove()
            activeListeners.remove(id)
        }

        // 2. Thêm listener cho tất cả thiết bị được cấp phép
        for (deviceId in rawAllowed) {
            val cleanId = deviceId.trim()
            val upperKey = cleanId.uppercase()
            if (cleanId.isNotEmpty() && !activeListeners.containsKey(upperKey)) {
                startDeviceListener(cleanId)
            }
        }
    }

    private fun startDeviceListener(deviceId: String) {
        val upperKey = deviceId.trim().uppercase()
        Log.d(TAG, "Starting Firestore listener for allowed device: $deviceId (key: $upperKey)")

        try {
            val db = FirebaseFirestore.getInstance()
            val docRef = db.collection("devices").document(deviceId)

            val registration = docRef.addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.e(TAG, "Firestore error for $deviceId: ${error.message}", error)
                    return@addSnapshotListener
                }

                if (snapshot != null && snapshot.exists()) {
                    val fallDetected = snapshot.getBoolean("fall_detected") ?: false
                    val ackFall = snapshot.getBoolean("ack_fall") ?: false
                    val fallTime = snapshot.getString("fall_time") ?: ""
                    val latitude = snapshot.getDouble("latitude") ?: 10.84
                    val longitude = snapshot.getDouble("longitude") ?: 106.77
                    val batteryPct = snapshot.getLong("battery_pct")?.toInt() ?: 100
                    val deviceName = snapshot.getString("name") ?: deviceId

                    Log.d(TAG, "Device $deviceId: fall_detected=$fallDetected, ack_fall=$ackFall, fall_time=$fallTime")

                    val keyFallDetected = "last_fall_detected_$deviceId"
                    val keyFallTime = "last_fall_time_$deviceId"

                    val lastFallDetected = prefs.getBoolean(keyFallDetected, false)
                    val lastFallTime = prefs.getString(keyFallTime, "") ?: ""

                    if (fallDetected) {
                        val isNewFall = !lastFallDetected || (fallTime.isNotEmpty() && fallTime != lastFallTime) || (!ackFall && alarmMediaPlayer == null)
                        if (isNewFall) {
                            Log.w(TAG, "🚨 NEW FALL DETECTED ON $deviceId ($deviceName)! Triggering background alert!")
                            prefs.edit()
                                .putBoolean(keyFallDetected, true)
                                .putString(keyFallTime, fallTime)
                                .apply()

                            triggerFallAlertNotification(deviceId, deviceName, fallTime, latitude, longitude, batteryPct)
                        }
                    } else {
                        prefs.edit().putBoolean(keyFallDetected, false).apply()
                        stopMediaAndVibration()
                    }
                }
            }

            activeListeners[upperKey] = registration
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start listener for $deviceId", e)
        }
    }

    private fun triggerFallAlertNotification(
        deviceId: String,
        deviceName: String,
        fallTime: String,
        latitude: Double,
        longitude: Double,
        batteryPct: Int
    ) {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Tap vào thông báo → mở app
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("notification_type", "fall_detected")
            putExtra("device_id", deviceId)
            putExtra("device_name", deviceName)
            putExtra("fall_time", fallTime)
            putExtra("latitude", latitude)
            putExtra("longitude", longitude)
        }
        val openAppPendingIntent = PendingIntent.getActivity(
            this,
            deviceId.hashCode(),
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val timeStr = if (fallTime.isNotEmpty()) {
            try {
                val inputFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
                val date = inputFormat.parse(fallTime)
                val outputFormat = SimpleDateFormat("HH:mm:ss dd/MM/yyyy", Locale.getDefault())
                if (date != null) outputFormat.format(date) else fallTime
            } catch (e: Exception) {
                fallTime
            }
        } else {
            SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
        }

        val locationStr = String.format(Locale.US, "📍 Vị trí: %.6f°N, %.6f°E", latitude, longitude)
        val displayName = if (deviceName.isNotEmpty() && deviceName != deviceId) "$deviceName ($deviceId)" else deviceId

        // Action xác nhận & tắt cảnh báo trực tiếp từ thanh thông báo
        val ackIntent = Intent(this, FallMonitoringService::class.java).apply {
            action = ACTION_DISMISS_NOTIFICATIONS
        }
        val ackPendingIntent = PendingIntent.getService(
            this,
            (deviceId + "_ack").hashCode(),
            ackIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val alertNotification = NotificationCompat.Builder(this, CHANNEL_ALERT_ID)
            .setContentTitle("🚨 CẢNH BÁO TÉ NGÃ: $displayName")
            .setContentText("Phát hiện té ngã lúc $timeStr – Nhấn để mở ứng dụng")
            .setStyle(NotificationCompat.BigTextStyle().bigText(
                "Phát hiện sự kiện té ngã từ $displayName lúc $timeStr.\n" +
                "$locationStr\nPin thiết bị: $batteryPct%\n\n" +
                "Nhấn vào để mở ứng dụng hỗ trợ ngay!"
            ))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openAppPendingIntent)
            .setAutoCancel(false)
            .setOngoing(true)
            .addAction(R.mipmap.ic_launcher, "✓ Đã kiểm tra — Tắt cảnh báo", ackPendingIntent)
            .build()

        // Notification ID duy nhất theo thiết bị
        val notifId = NOTIFICATION_ID_ALERT + (Math.abs(deviceId.hashCode()) % 10000) + 1
        notificationManager.notify(notifId, alertNotification)

        // Báo cho React Native ngay lập tức nếu app đang mở
        CareDropBridgeModule.emitFallAlert(deviceId, deviceName, fallTime, latitude, longitude)

        // Phát báo động lặp lại liên tục (như báo thức)
        startAlarm()
    }


    /**
     * Phát âm thanh báo thức lặp lại + rung lặp lại liên tục
     * cho đến khi người dùng nhấn "Tắt báo động"
     */
    private fun startAlarm() {
        // Dừng âm thanh/rung cũ nếu đang phát, TUYỆT ĐỐI không hủy thông báo trên khay hệ thống
        stopMediaAndVibration()

        // ── Phát âm thanh lặp lại ──────────────────────────────────────────
        try {
            val alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

            val audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()

            alarmMediaPlayer = MediaPlayer().apply {
                setAudioAttributes(audioAttributes)
                setDataSource(applicationContext, alarmUri)
                isLooping = true  // Lặp lại vô tận
                setVolume(1.0f, 1.0f)
                prepare()
                start()
            }
            Log.d(TAG, "Alarm MediaPlayer started (looping)")
        } catch (e: Exception) {
            Log.e(TAG, "Error starting alarm MediaPlayer", e)
        }

        // ── Rung lặp lại liên tục ──────────────────────────────────────────
        try {
            val pattern = longArrayOf(0, 900, 300, 900, 300, 900, 300)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                alarmVibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                alarmVibrator = alarmVibratorManager?.defaultVibrator
                alarmVibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))  // repeat từ index 0
            } else {
                @Suppress("DEPRECATION")
                alarmVibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    alarmVibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
                } else {
                    @Suppress("DEPRECATION")
                    alarmVibrator?.vibrate(pattern, 0)  // repeat từ index 0
                }
            }
            Log.d(TAG, "Continuous vibration started")
        } catch (e: Exception) {
            Log.e(TAG, "Error starting continuous vibration", e)
        }
    }

    /**
     * Dừng riêng âm thanh MediaPlayer và rung Vibrator.
     * Giữ nguyên thông báo trong Notification Drawer để người dùng có thể xem lại.
     */
    private fun stopMediaAndVibration() {
        try {
            alarmMediaPlayer?.let {
                if (it.isPlaying) it.stop()
                it.release()
            }
            alarmMediaPlayer = null
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping alarm MediaPlayer", e)
        }

        try {
            alarmVibrator?.cancel()
            alarmVibrator = null
            alarmVibratorManager = null
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping vibration", e)
        }
    }

    /**
     * Dừng âm thanh và rung báo động khi người dùng bấm tắt hoặc hết thời gian báo.
     * KHÔNG hủy các thông báo trên thanh thông báo.
     */
    private fun stopAlarm() {
        stopMediaAndVibration()
        Log.d(TAG, "Alarm sound and vibration stopped")
    }

    /**
     * Chỉ xóa các thông báo cảnh báo té ngã khi người dùng bấm nút xác nhận trong app.
     */
    fun dismissAlertNotifications() {
        try {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            for (i in 0..10000) {
                notificationManager.cancel(NOTIFICATION_ID_ALERT + i)
            }
            Log.d(TAG, "Alert notifications cleared by user dismissal")
        } catch (e: Exception) {
            Log.e(TAG, "Error canceling alert notifications", e)
        }
    }



    private fun stopMonitoring() {
        stopAlarm()  // Dừng báo động nếu đang phát
        userListener?.remove()
        userListener = null
        for (reg in activeListeners.values) {
            reg.remove()
        }
        activeListeners.clear()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "onDestroy: Stopping FallMonitoringService")
        stopMonitoring()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
