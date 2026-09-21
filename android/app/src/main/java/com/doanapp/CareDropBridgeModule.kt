package com.doanapp

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

class CareDropBridgeModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "CareDropBridge"

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
}
