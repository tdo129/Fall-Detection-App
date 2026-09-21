package com.doanapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat

class BootReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        Log.d(TAG, "onReceive: action=$action")

        if (Intent.ACTION_BOOT_COMPLETED == action || Intent.ACTION_MY_PACKAGE_REPLACED == action) {
            try {
                val serviceIntent = Intent(context, FallMonitoringService::class.java).apply {
                    this.action = FallMonitoringService.ACTION_START
                }
                ContextCompat.startForegroundService(context, serviceIntent)
                Log.d(TAG, "FallMonitoringService started successfully after boot/update")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start FallMonitoringService on boot: ${e.message}", e)
            }
        }
    }
}
