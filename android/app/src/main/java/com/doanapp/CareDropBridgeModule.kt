package com.doanapp

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions

class CareDropBridgeModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private var reactContextRef: ReactApplicationContext? = null

        private fun createFallMap(
            deviceId: String,
            deviceName: String,
            fallTime: String,
            latitude: Double,
            longitude: Double
        ): WritableMap {
            return Arguments.createMap().apply {
                putString("type", "fall_detected")
                putString("deviceId", deviceId)
                putString("device_id", deviceId)
                putString("deviceName", deviceName)
                putString("device_name", deviceName)
                putString("fallTime", fallTime)
                putString("fall_time", fallTime)
                putDouble("latitude", latitude)
                putDouble("longitude", longitude)
            }
        }

        fun emitPendingFallAlert(intent: Intent) {
            try {
                val context = reactContextRef ?: return
                val deviceId = intent.getStringExtra("device_id") ?: ""
                val deviceName = intent.getStringExtra("device_name") ?: ""
                val fallTime = intent.getStringExtra("fall_time") ?: ""
                val latitude = intent.getDoubleExtra("latitude", 10.84)
                val longitude = intent.getDoubleExtra("longitude", 106.77)

                context.runOnJSQueueThread {
                    try {
                        val emitter = context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        emitter.emit("onFallAlertTriggered", createFallMap(deviceId, deviceName, fallTime, latitude, longitude))
                        emitter.emit("onFallNotificationTapped", createFallMap(deviceId, deviceName, fallTime, latitude, longitude))
                        Log.d("CareDropBridge", "Emitted pending fall alert on JS thread for $deviceId")
                    } catch (e: Exception) {
                        Log.e("CareDropBridge", "Error in JS queue emitting pending fall alert", e)
                    }
                }
            } catch (e: Exception) {
                Log.e("CareDropBridge", "Error emitting pending fall alert", e)
            }
        }

        fun emitFallAlert(deviceId: String, deviceName: String, fallTime: String, latitude: Double, longitude: Double) {
            try {
                val context = reactContextRef
                if (context == null) {
                    Log.w("CareDropBridge", "Cannot emit fall alert: reactContextRef is null")
                    return
                }
                context.runOnJSQueueThread {
                    try {
                        val emitter = context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        emitter.emit("onFallAlertTriggered", createFallMap(deviceId, deviceName, fallTime, latitude, longitude))
                        emitter.emit("onFallNotificationTapped", createFallMap(deviceId, deviceName, fallTime, latitude, longitude))
                        Log.d("CareDropBridge", "Emitted live fall alert on JS thread for device $deviceId")
                    } catch (e: Exception) {
                        Log.e("CareDropBridge", "Error emitting fall alert on JS thread", e)
                    }
                }
            } catch (e: Exception) {
                Log.e("CareDropBridge", "Error emitting fall alert", e)
            }
        }
    }

    init {
        reactContextRef = reactContext
    }

    override fun getName(): String = "CareDropBridge"

    @ReactMethod
    fun getInitialFallAlert(promise: Promise) {
        try {
            val intent = MainActivity.initialFallIntent
            if (intent != null && intent.getStringExtra("notification_type") == "fall_detected") {
                val map = Arguments.createMap().apply {
                    putString("type", "fall_detected")
                    putString("deviceId", intent.getStringExtra("device_id") ?: "")
                    putString("deviceName", intent.getStringExtra("device_name") ?: "")
                    putString("fallTime", intent.getStringExtra("fall_time") ?: "")
                    putDouble("latitude", intent.getDoubleExtra("latitude", 10.84))
                    putDouble("longitude", intent.getDoubleExtra("longitude", 106.77))
                }
                MainActivity.initialFallIntent = null
                promise.resolve(map)
                return
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun setAllowedAlertDevices(deviceIds: ReadableArray) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("CareDropBackground", Context.MODE_PRIVATE)
            val set = HashSet<String>()
            for (i in 0 until deviceIds.size()) {
                val id = deviceIds.getString(i)
                if (!id.isNullOrEmpty()) {
                    set.add(id.trim())
                    set.add(id.trim().uppercase())
                }
            }
            prefs.edit().putStringSet("allowed_device_ids", set).apply()
            Log.d("CareDropBridge", "Saved allowed device IDs: $set")

            // Gửi action cập nhật tới FallMonitoringService
            val intent = Intent(reactApplicationContext, FallMonitoringService::class.java).apply {
                action = FallMonitoringService.ACTION_SYNC_DEVICES
            }
            ContextCompat.startForegroundService(reactApplicationContext, intent)
        } catch (e: Exception) {
            Log.e("CareDropBridge", "Error setting allowed alert devices", e)
        }
    }

    @ReactMethod
    fun setUserEmail(email: String) {
        try {
            val cleanEmail = email.trim().lowercase()
            val prefs = reactApplicationContext.getSharedPreferences("CareDropBackground", Context.MODE_PRIVATE)
            prefs.edit().putString("user_email", cleanEmail).apply()
            Log.d("CareDropBridge", "Saved user email: $cleanEmail")

            val intent = Intent(reactApplicationContext, FallMonitoringService::class.java).apply {
                action = FallMonitoringService.ACTION_SYNC_DEVICES
            }
            ContextCompat.startForegroundService(reactApplicationContext, intent)
        } catch (e: Exception) {
            Log.e("CareDropBridge", "Error setting user email", e)
        }
    }

    @ReactMethod
    fun startAlarm() {
        try {
            Log.d("CareDropBridge", "startAlarm called from JS")
            val intent = Intent(reactApplicationContext, FallMonitoringService::class.java).apply {
                action = FallMonitoringService.ACTION_START_ALARM
            }
            reactApplicationContext.startService(intent)
        } catch (e: Exception) {
            Log.e("CareDropBridge", "Error starting alarm", e)
        }
    }

    @ReactMethod
    fun startAlarmWithDetails(payload: com.facebook.react.bridge.ReadableMap) {
        try {
            Log.d("CareDropBridge", "startAlarmWithDetails called from JS: $payload")
            val intent = Intent(reactApplicationContext, FallMonitoringService::class.java).apply {
                action = FallMonitoringService.ACTION_START_ALARM
                if (payload.hasKey("deviceId")) putExtra("deviceId", payload.getString("deviceId"))
                if (payload.hasKey("deviceName")) putExtra("deviceName", payload.getString("deviceName"))
                if (payload.hasKey("fallTime")) putExtra("fallTime", payload.getString("fallTime"))
                if (payload.hasKey("latitude")) putExtra("latitude", payload.getDouble("latitude"))
                if (payload.hasKey("longitude")) putExtra("longitude", payload.getDouble("longitude"))
                if (payload.hasKey("batteryPct")) putExtra("batteryPct", payload.getInt("batteryPct"))
            }
            reactApplicationContext.startService(intent)
        } catch (e: Exception) {
            Log.e("CareDropBridge", "Error starting alarm with details", e)
        }
    }

    @ReactMethod
    fun stopAlarm() {
        try {
            Log.d("CareDropBridge", "stopAlarm called from JS")
            val intent = Intent(reactApplicationContext, FallMonitoringService::class.java).apply {
                action = FallMonitoringService.ACTION_STOP_ALARM
            }
            reactApplicationContext.startService(intent)
        } catch (e: Exception) {
            Log.e("CareDropBridge", "Error stopping alarm", e)
        }
    }

    @ReactMethod
    fun dismissNotifications() {
        try {
            Log.d("CareDropBridge", "dismissNotifications called from JS")
            val intent = Intent(reactApplicationContext, FallMonitoringService::class.java).apply {
                action = FallMonitoringService.ACTION_DISMISS_NOTIFICATIONS
            }
            reactApplicationContext.startService(intent)
        } catch (e: Exception) {
            Log.e("CareDropBridge", "Error dismissing notifications", e)
        }
    }

    @ReactMethod
    fun syncDevicesAndUser(deviceIds: ReadableArray, email: String) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("CareDropBackground", Context.MODE_PRIVATE)
            val set = HashSet<String>()
            for (i in 0 until deviceIds.size()) {
                val id = deviceIds.getString(i)
                if (!id.isNullOrEmpty()) {
                    set.add(id.trim())
                    set.add(id.trim().uppercase())
                }
            }
            val cleanEmail = email.trim().lowercase()
            prefs.edit()
                .putStringSet("allowed_device_ids", set)
                .putString("user_email", cleanEmail)
                .apply()
            Log.d("CareDropBridge", "syncDevicesAndUser: devices=$set, email=$cleanEmail")

            val intent = Intent(reactApplicationContext, FallMonitoringService::class.java).apply {
                action = FallMonitoringService.ACTION_SYNC_DEVICES
            }
            ContextCompat.startForegroundService(reactApplicationContext, intent)
        } catch (e: Exception) {
            Log.e("CareDropBridge", "Error in syncDevicesAndUser", e)
        }
    }

    @ReactMethod
    fun acknowledgeFall(deviceId: String) {
        try {
            val cleanId = deviceId.trim()
            Log.d("CareDropBridge", "Native acknowledgeFall called for: $cleanId")
            if (cleanId.isNotEmpty()) {
                val db = FirebaseFirestore.getInstance()
                val updates = mapOf<String, Any>(
                    "fall_detected" to false,
                    "ack_fall" to true
                )
                db.collection("devices").document(cleanId)
                    .update(updates)
                    .addOnSuccessListener {
                        Log.d("CareDropBridge", "Native Firestore update SUCCESS for $cleanId: fall_detected=false, ack_fall=true")
                    }
                    .addOnFailureListener {
                        Log.d("CareDropBridge", "Native update failed for $cleanId, attempting set with merge")
                        db.collection("devices").document(cleanId)
                            .set(updates, SetOptions.merge())
                    }
            }
        } catch (e: Exception) {
            Log.e("CareDropBridge", "Error in native acknowledgeFall", e)
        }
    }

    @ReactMethod
    fun acknowledgeFallDevices(deviceIds: ReadableArray) {
        try {
            Log.d("CareDropBridge", "Native acknowledgeFallDevices called with ${deviceIds.size()} devices")
            val db = FirebaseFirestore.getInstance()
            val updates = mapOf<String, Any>(
                "fall_detected" to false,
                "ack_fall" to true
            )
            for (i in 0 until deviceIds.size()) {
                val id = deviceIds.getString(i)?.trim() ?: ""
                if (id.isNotEmpty()) {
                    db.collection("devices").document(id)
                        .update(updates)
                        .addOnFailureListener {
                            db.collection("devices").document(id)
                                .set(updates, SetOptions.merge())
                        }
                }
            }
        } catch (e: Exception) {
            Log.e("CareDropBridge", "Error in native acknowledgeFallDevices", e)
        }
    }
}

