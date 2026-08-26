package com.papayasamosa.hrmonitor

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import java.util.UUID

data class HrReading(val heartRate: Int, val rrIntervals: List<Int>)

private fun uuid16(id: Long): UUID =
    UUID.fromString(String.format("%08x-0000-1000-8000-00805f9b34fb", id))

object BleGattUuids {
    val HEART_RATE_SERVICE: UUID = uuid16(0x180D)
    val HEART_RATE_MEASUREMENT: UUID = uuid16(0x2A37)
    val BATTERY_SERVICE: UUID = uuid16(0x180F)
    val BATTERY_LEVEL: UUID = uuid16(0x2A19)
    val CLIENT_CHARACTERISTIC_CONFIG: UUID = uuid16(0x2902)
}

/**
 * Owns the single BluetoothGatt connection to the heart-rate monitor and the
 * active recording's running stats. A singleton (not tied to the Activity or
 * to the Capacitor plugin instance) so it keeps running for as long as the
 * process is alive - which HrRecordingService guarantees, via a foreground
 * service, while a recording is active, independent of whether the
 * WebView/Activity is currently visible.
 *
 * Uses only the pre-API-33 BluetoothGattCallback overloads (reading
 * `characteristic.value` rather than the newer callback-supplied `value`
 * parameter) to keep one code path instead of two - those methods remain
 * functional on current Android versions, just deprecated.
 */
@Suppress("DEPRECATION")
object BleManager {
    private var bluetoothGatt: BluetoothGatt? = null
    private val handler = Handler(Looper.getMainLooper())

    var connectedDeviceId: String? = null
        private set
    var connectedDeviceName: String? = null
        private set

    /** Fires for every parsed heart-rate reading, recording or not - drives the live BPM display. */
    var onReading: ((HrReading) -> Unit)? = null
    /** Fires with the address of the device that just disconnected. */
    var onDisconnected: ((deviceId: String) -> Unit)? = null

    /** Set while a recording is active; readings are persisted to SQLite directly from here. */
    private var activeSessionId: String? = null
    private var recordingStartedAtMs = 0L
    private var statSum = 0L
    private var statCount = 0
    private var statMin = Int.MAX_VALUE
    private var statMax = Int.MIN_VALUE

    /** Fires with a live stats snapshot on every reading while recording (for the notification + JS event). */
    var onRecordingStats: ((sessionId: String, average: Int, min: Int, max: Int, count: Int) -> Unit)? = null

    private var pendingBatteryCallback: ((Int?) -> Unit)? = null

    fun startScanAndConnect(
        context: Context,
        timeoutMs: Long = 15000,
        onResult: (deviceId: String?, deviceName: String?, error: String?) -> Unit
    ) {
        val adapter = BluetoothAdapter.getDefaultAdapter()
        if (adapter == null || !adapter.isEnabled) {
            onResult(null, null, "Bluetooth is not available or turned off")
            return
        }
        val scanner = adapter.bluetoothLeScanner
        if (scanner == null) {
            onResult(null, null, "BLE scanning is not supported on this device")
            return
        }

        val filters = listOf(
            ScanFilter.Builder().setServiceUuid(ParcelUuid(BleGattUuids.HEART_RATE_SERVICE)).build()
        )
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()

        var resolved = false
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                if (resolved) return
                resolved = true
                scanner.stopScan(this)
                connectToDevice(context, result.device, onResult)
            }

            override fun onScanFailed(errorCode: Int) {
                if (resolved) return
                resolved = true
                onResult(null, null, "BLE scan failed with code $errorCode")
            }
        }

        scanner.startScan(filters, settings, callback)
        handler.postDelayed({
            if (!resolved) {
                resolved = true
                scanner.stopScan(callback)
                onResult(null, null, "No heart rate monitor found nearby")
            }
        }, timeoutMs)
    }

    /**
     * Connect directly to a previously-used device address, skipping the BLE
     * scan entirely - used for silent auto-reconnect on app launch. Bounded
     * by a timeout since connectGatt() has none of its own: if the device
     * isn't currently in range/powered on, onConnectionStateChange may never
     * fire at all.
     */
    fun connectToKnownDevice(
        context: Context,
        deviceId: String,
        timeoutMs: Long = 8000,
        onResult: (deviceId: String?, deviceName: String?, error: String?) -> Unit
    ) {
        val adapter = BluetoothAdapter.getDefaultAdapter()
        if (adapter == null || !adapter.isEnabled) {
            onResult(null, null, "Bluetooth is not available or turned off")
            return
        }
        val device = try {
            adapter.getRemoteDevice(deviceId)
        } catch (e: IllegalArgumentException) {
            onResult(null, null, "Invalid device address")
            return
        }

        var resolved = false
        val timeoutRunnable = Runnable {
            if (!resolved) {
                resolved = true
                bluetoothGatt?.close()
                bluetoothGatt = null
                onResult(null, null, "Device not reachable")
            }
        }
        handler.postDelayed(timeoutRunnable, timeoutMs)

        connectToDevice(context, device) { id, name, error ->
            if (resolved) return@connectToDevice
            resolved = true
            handler.removeCallbacks(timeoutRunnable)
            onResult(id, name, error)
        }
    }

    @Suppress("OVERRIDE_DEPRECATION")
    private fun connectToDevice(
        context: Context,
        device: BluetoothDevice,
        onResult: (String?, String?, String?) -> Unit
    ) {
        val gattCallback = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    connectedDeviceId = device.address
                    connectedDeviceName = device.name ?: "Unknown Device"
                    gatt.discoverServices()
                    handler.post { onResult(connectedDeviceId, connectedDeviceName, null) }
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    val previousDeviceId = connectedDeviceId
                    connectedDeviceId = null
                    connectedDeviceName = null
                    bluetoothGatt = null
                    if (previousDeviceId != null) {
                        handler.post { onDisconnected?.invoke(previousDeviceId) }
                    }
                }
            }

            override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
                if (characteristic.uuid == BleGattUuids.HEART_RATE_MEASUREMENT) {
                    handleReading(parseHeartRate(characteristic.value))
                }
            }

            override fun onCharacteristicRead(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic,
                status: Int
            ) {
                if (characteristic.uuid == BleGattUuids.BATTERY_LEVEL) {
                    val level = if (status == BluetoothGatt.GATT_SUCCESS && characteristic.value.isNotEmpty()) {
                        characteristic.value[0].toInt() and 0xFF
                    } else {
                        null
                    }
                    val callback = pendingBatteryCallback
                    pendingBatteryCallback = null
                    handler.post { callback?.invoke(level) }
                }
            }
        }
        bluetoothGatt = device.connectGatt(context, false, gattCallback)
    }

    private fun handleReading(reading: HrReading) {
        // Some monitors report a 0 BPM "no contact" reading instead of simply
        // falling silent when taken off-skin (observed on real hardware: the
        // notification keeps arriving on schedule, just carrying heartRate 0,
        // occasionally with a noisy non-zero spike right at the transition).
        // Treat a non-positive reading as no signal at all: never forward it
        // to the UI/JS layer and never let it pollute persisted session stats
        // or the recorded readings.
        if (reading.heartRate <= 0) return

        handler.post { onReading?.invoke(reading) }

        val sessionId = activeSessionId ?: return
        val elapsedMs = System.currentTimeMillis() - recordingStartedAtMs
        HrDatabaseHelper.appendReading(sessionId, reading.heartRate, elapsedMs, reading.rrIntervals)

        statSum += reading.heartRate
        statCount += 1
        if (reading.heartRate < statMin) statMin = reading.heartRate
        if (reading.heartRate > statMax) statMax = reading.heartRate
        val average = (statSum / statCount).toInt()
        val sid = sessionId
        handler.post { onRecordingStats?.invoke(sid, average, statMin, statMax, statCount) }
    }

    fun beginRecordingStats(sessionId: String, startedAtMs: Long) {
        activeSessionId = sessionId
        recordingStartedAtMs = startedAtMs
        statSum = 0
        statCount = 0
        statMin = Int.MAX_VALUE
        statMax = Int.MIN_VALUE
    }

    fun currentStatsSnapshot(): IntArray = intArrayOf(
        if (statCount > 0) (statSum / statCount).toInt() else 0,
        if (statMin == Int.MAX_VALUE) 0 else statMin,
        if (statMax == Int.MIN_VALUE) 0 else statMax,
        statCount
    )

    fun endRecordingStats() {
        activeSessionId = null
    }

    fun startNotifications() {
        val gatt = bluetoothGatt ?: return
        val characteristic = gatt.getService(BleGattUuids.HEART_RATE_SERVICE)
            ?.getCharacteristic(BleGattUuids.HEART_RATE_MEASUREMENT) ?: return
        gatt.setCharacteristicNotification(characteristic, true)
        val descriptor = characteristic.getDescriptor(BleGattUuids.CLIENT_CHARACTERISTIC_CONFIG)
        if (descriptor != null) {
            descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            gatt.writeDescriptor(descriptor)
        }
    }

    fun stopNotifications() {
        val gatt = bluetoothGatt ?: return
        val characteristic = gatt.getService(BleGattUuids.HEART_RATE_SERVICE)
            ?.getCharacteristic(BleGattUuids.HEART_RATE_MEASUREMENT) ?: return
        gatt.setCharacteristicNotification(characteristic, false)
    }

    fun disconnect() {
        bluetoothGatt?.disconnect()
        bluetoothGatt?.close()
        bluetoothGatt = null
        connectedDeviceId = null
        connectedDeviceName = null
    }

    fun readBattery(onResult: (Int?) -> Unit) {
        val gatt = bluetoothGatt
        val characteristic = gatt?.getService(BleGattUuids.BATTERY_SERVICE)
            ?.getCharacteristic(BleGattUuids.BATTERY_LEVEL)
        if (gatt == null || characteristic == null) {
            onResult(null)
            return
        }

        var resolved = false
        val resolveOnce: (Int?) -> Unit = { level ->
            if (!resolved) {
                resolved = true
                pendingBatteryCallback = null
                onResult(level)
            }
        }
        pendingBatteryCallback = resolveOnce

        // Android's BluetoothGatt allows only one outstanding operation at a
        // time - if something else (e.g. the notification descriptor write
        // from startNotifications) is still in flight, readCharacteristic()
        // returns false and onCharacteristicRead never fires. Without this
        // guard the caller's promise would hang forever.
        val queued = gatt.readCharacteristic(characteristic)
        if (!queued) {
            resolveOnce(null)
            return
        }

        // Backstop in case the read was queued but the callback never arrives for any other reason.
        handler.postDelayed({ resolveOnce(null) }, 5000)
    }

    /** Parses the standard Bluetooth Heart Rate Measurement characteristic (0x2A37). */
    private fun parseHeartRate(value: ByteArray): HrReading {
        val flags = value[0].toInt() and 0xFF
        val rate16Bits = flags and 0x1 != 0
        var index = 1
        val heartRate: Int
        if (rate16Bits) {
            heartRate = (value[index].toInt() and 0xFF) or ((value[index + 1].toInt() and 0xFF) shl 8)
            index += 2
        } else {
            heartRate = value[index].toInt() and 0xFF
            index += 1
        }

        val energyPresent = flags and 0x8 != 0
        if (energyPresent) index += 2

        val rrIntervals = mutableListOf<Int>()
        val rrPresent = flags and 0x10 != 0
        if (rrPresent) {
            while (index + 1 < value.size) {
                val rr = (value[index].toInt() and 0xFF) or ((value[index + 1].toInt() and 0xFF) shl 8)
                rrIntervals.add(rr)
                index += 2
            }
        }

        return HrReading(heartRate, rrIntervals)
    }
}
