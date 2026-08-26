package com.papayasamosa.hrmonitor

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Local SQLite storage for sessions and readings - the Android equivalent of
 * the web build's IndexedDB adapter (src/services/storage/webStorage.js).
 * Exposes JSON so the JS-side androidStorage.js adapter can JSON.parse() it
 * directly, keeping the same session/reading shape on both platforms.
 */
object HrDatabaseHelper {
    private const val DB_NAME = "hr_monitor.db"
    private const val DB_VERSION = 3

    private lateinit var helper: OpenHelper

    fun init(context: Context) {
        if (::helper.isInitialized) return
        helper = OpenHelper(context.applicationContext)
    }

    private class OpenHelper(context: Context) : SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {
        override fun onConfigure(db: SQLiteDatabase) {
            db.setForeignKeyConstraintsEnabled(true)
        }

        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE sessions (
                    id TEXT PRIMARY KEY,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    effective_ended_at TEXT,
                    duration_ms INTEGER,
                    device_name TEXT,
                    session_type TEXT,
                    average_hr INTEGER NOT NULL DEFAULT 0,
                    minimum_hr INTEGER NOT NULL DEFAULT 0,
                    maximum_hr INTEGER NOT NULL DEFAULT 0,
                    reading_count INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    import_fingerprint TEXT
                )
                """.trimIndent()
            )
            db.execSQL(
                """
                CREATE TABLE readings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    elapsed_ms INTEGER NOT NULL,
                    heart_rate_bpm INTEGER NOT NULL,
                    rr_intervals TEXT,
                    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
                )
                """.trimIndent()
            )
            db.execSQL(
                """
                CREATE TABLE speed_events (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    recorded_at TEXT NOT NULL,
                    speed_canonical REAL NOT NULL,
                    entered_value REAL NOT NULL,
                    entered_unit TEXT NOT NULL,
                    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
                )
                """.trimIndent()
            )
            db.execSQL("CREATE INDEX idx_readings_session_id ON readings(session_id)")
            db.execSQL("CREATE INDEX idx_sessions_started_at ON sessions(started_at)")
            db.execSQL("CREATE INDEX idx_speed_events_session_id ON speed_events(session_id)")
            db.execSQL("CREATE INDEX idx_sessions_import_fingerprint ON sessions(import_fingerprint)")
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
            // v1 -> v2: add effective_ended_at, defaulting to the existing ended_at so
            // already-recorded sessions aren't affected until someone trims them.
            // Additive only - existing sessions/readings are never dropped.
            if (oldVersion < 2) {
                db.execSQL("ALTER TABLE sessions ADD COLUMN effective_ended_at TEXT")
                db.execSQL("UPDATE sessions SET effective_ended_at = ended_at WHERE effective_ended_at IS NULL")
            }

            // v2 -> v3: treadmill speed events (own table, zero rows for
            // existing sessions) and an import-fingerprint column for CSV
            // import de-duplication. Additive only.
            if (oldVersion < 3) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS speed_events (
                        id TEXT PRIMARY KEY,
                        session_id TEXT NOT NULL,
                        recorded_at TEXT NOT NULL,
                        speed_canonical REAL NOT NULL,
                        entered_value REAL NOT NULL,
                        entered_unit TEXT NOT NULL,
                        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
                    )
                    """.trimIndent()
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS idx_speed_events_session_id ON speed_events(session_id)")
                db.execSQL("ALTER TABLE sessions ADD COLUMN import_fingerprint TEXT")
                db.execSQL("CREATE INDEX IF NOT EXISTS idx_sessions_import_fingerprint ON sessions(import_fingerprint)")
            }
        }
    }

    private fun db(): SQLiteDatabase = helper.writableDatabase

    fun createSession(session: JSONObject) {
        val values = ContentValues().apply {
            put("id", session.getString("id"))
            put("started_at", session.getString("startedAt"))
            put("device_name", session.optString("deviceName", "Unknown Device"))
            put("session_type", if (session.isNull("sessionType")) null else session.optString("sessionType"))
            put("status", session.optString("status", "recording"))
            put("created_at", session.optString("startedAt"))
            if (session.has("importFingerprint") && !session.isNull("importFingerprint")) {
                put("import_fingerprint", session.getString("importFingerprint"))
            }
        }
        db().insertOrThrow("sessions", null, values)
    }

    fun appendReading(sessionId: String, heartRate: Int, elapsedMs: Long, rrIntervals: List<Int>) {
        val values = ContentValues().apply {
            put("session_id", sessionId)
            put("timestamp", isoNow())
            put("elapsed_ms", elapsedMs)
            put("heart_rate_bpm", heartRate)
            if (rrIntervals.isNotEmpty()) put("rr_intervals", JSONArray(rrIntervals).toString())
        }
        db().insert("readings", null, values)
    }

    fun finalizeSession(
        sessionId: String,
        endedAt: String,
        durationMs: Long,
        status: String,
        average: Int,
        minimum: Int,
        maximum: Int,
        count: Int
    ) {
        val values = ContentValues().apply {
            put("ended_at", endedAt)
            put("effective_ended_at", endedAt)
            put("duration_ms", durationMs)
            put("status", status)
            put("average_hr", average)
            put("minimum_hr", minimum)
            put("maximum_hr", maximum)
            put("reading_count", count)
        }
        db().update("sessions", values, "id = ?", arrayOf(sessionId))
    }

    /**
     * Trim (or restore) a completed session's effective end time and
     * recalculate its stats from the readings at or before the new cutoff.
     * Raw readings are never deleted, so this can be changed again later.
     */
    fun updateEffectiveEndTime(sessionId: String, effectiveEndedAt: String) {
        val session = getSession(sessionId) ?: return
        val startedAtMs = parseIso(session.getString("startedAt"))
        val cutoffMs = parseIso(effectiveEndedAt) - startedAtMs

        val readings = getReadings(sessionId)
        var sum = 0L
        var count = 0
        var min = Int.MAX_VALUE
        var max = Int.MIN_VALUE
        for (i in 0 until readings.length()) {
            val reading = readings.getJSONObject(i)
            if (reading.getLong("elapsedMs") <= cutoffMs) {
                val hr = reading.getInt("heartRate")
                sum += hr
                count += 1
                if (hr < min) min = hr
                if (hr > max) max = hr
            }
        }
        val average = if (count > 0) (sum / count).toInt() else 0
        if (min == Int.MAX_VALUE) min = 0
        if (max == Int.MIN_VALUE) max = 0

        val values = ContentValues().apply {
            put("effective_ended_at", effectiveEndedAt)
            put("duration_ms", cutoffMs)
            put("average_hr", average)
            put("minimum_hr", min)
            put("maximum_hr", max)
            put("reading_count", count)
        }
        db().update("sessions", values, "id = ?", arrayOf(sessionId))
    }

    fun listSessions(): JSONArray {
        val result = JSONArray()
        db().query("sessions", null, null, null, null, null, "started_at DESC").use { cursor ->
            while (cursor.moveToNext()) result.put(sessionFromCursor(cursor))
        }
        return result
    }

    fun getSession(sessionId: String): JSONObject? {
        db().query("sessions", null, "id = ?", arrayOf(sessionId), null, null, null).use { cursor ->
            return if (cursor.moveToFirst()) sessionFromCursor(cursor) else null
        }
    }

    fun getReadings(sessionId: String): JSONArray {
        val result = JSONArray()
        db().query("readings", null, "session_id = ?", arrayOf(sessionId), null, null, "elapsed_ms ASC").use { cursor ->
            while (cursor.moveToNext()) {
                val reading = JSONObject()
                reading.put("timestamp", cursor.getString(cursor.getColumnIndexOrThrow("timestamp")))
                reading.put("elapsedMs", cursor.getLong(cursor.getColumnIndexOrThrow("elapsed_ms")))
                reading.put("heartRate", cursor.getInt(cursor.getColumnIndexOrThrow("heart_rate_bpm")))
                val rrIndex = cursor.getColumnIndexOrThrow("rr_intervals")
                if (!cursor.isNull(rrIndex)) reading.put("rrIntervals", JSONArray(cursor.getString(rrIndex)))
                result.put(reading)
            }
        }
        return result
    }

    fun deleteSession(sessionId: String) {
        // readings cascade-delete via the FOREIGN KEY ... ON DELETE CASCADE constraint
        db().delete("sessions", "id = ?", arrayOf(sessionId))
    }

    fun findActiveSession(): JSONObject? {
        db().query("sessions", null, "status = ?", arrayOf("recording"), null, null, "started_at DESC", "1").use { cursor ->
            return if (cursor.moveToFirst()) sessionFromCursor(cursor) else null
        }
    }

    fun findSessionByImportFingerprint(fingerprint: String): JSONObject? {
        db().query("sessions", null, "import_fingerprint = ?", arrayOf(fingerprint), null, null, null, "1").use { cursor ->
            return if (cursor.moveToFirst()) sessionFromCursor(cursor) else null
        }
    }

    // --- Speed events ----------------------------------------------------------

    fun addSpeedEvent(event: JSONObject) {
        val values = ContentValues().apply {
            put("id", event.getString("id"))
            put("session_id", event.getString("sessionId"))
            put("recorded_at", event.getString("recordedAt"))
            put("speed_canonical", event.getDouble("speedCanonical"))
            put("entered_value", event.getDouble("enteredValue"))
            put("entered_unit", event.getString("enteredUnit"))
        }
        db().insertOrThrow("speed_events", null, values)
    }

    fun getSpeedEventsForSession(sessionId: String): JSONArray {
        val result = JSONArray()
        db().query(
            "speed_events", null, "session_id = ?", arrayOf(sessionId), null, null, "recorded_at ASC"
        ).use { cursor ->
            while (cursor.moveToNext()) result.put(speedEventFromCursor(cursor))
        }
        return result
    }

    fun updateSpeedEvent(eventId: String, updates: JSONObject) {
        val values = ContentValues()
        if (updates.has("recordedAt")) values.put("recorded_at", updates.getString("recordedAt"))
        if (updates.has("speedCanonical")) values.put("speed_canonical", updates.getDouble("speedCanonical"))
        if (updates.has("enteredValue")) values.put("entered_value", updates.getDouble("enteredValue"))
        if (updates.has("enteredUnit")) values.put("entered_unit", updates.getString("enteredUnit"))
        if (values.size() == 0) return
        db().update("speed_events", values, "id = ?", arrayOf(eventId))
    }

    fun deleteSpeedEvent(eventId: String) {
        db().delete("speed_events", "id = ?", arrayOf(eventId))
    }

    private fun speedEventFromCursor(cursor: Cursor): JSONObject {
        fun col(name: String) = cursor.getColumnIndexOrThrow(name)
        val event = JSONObject()
        event.put("id", cursor.getString(col("id")))
        event.put("sessionId", cursor.getString(col("session_id")))
        event.put("recordedAt", cursor.getString(col("recorded_at")))
        event.put("speedCanonical", cursor.getDouble(col("speed_canonical")))
        event.put("enteredValue", cursor.getDouble(col("entered_value")))
        event.put("enteredUnit", cursor.getString(col("entered_unit")))
        return event
    }

    private fun sessionFromCursor(cursor: Cursor): JSONObject {
        fun col(name: String) = cursor.getColumnIndexOrThrow(name)
        val session = JSONObject()
        session.put("id", cursor.getString(col("id")))
        session.put("startedAt", cursor.getString(col("started_at")))
        session.put("endedAt", cursor.getString(col("ended_at")))
        session.put("effectiveEndedAt", cursor.getString(col("effective_ended_at")))
        val durationIndex = col("duration_ms")
        session.put("durationMs", if (cursor.isNull(durationIndex)) JSONObject.NULL else cursor.getLong(durationIndex))
        session.put("deviceName", cursor.getString(col("device_name")))
        session.put("sessionType", cursor.getString(col("session_type")))
        session.put("averageHeartRate", cursor.getInt(col("average_hr")))
        session.put("minimumHeartRate", cursor.getInt(col("minimum_hr")))
        session.put("maximumHeartRate", cursor.getInt(col("maximum_hr")))
        session.put("readingCount", cursor.getInt(col("reading_count")))
        session.put("status", cursor.getString(col("status")))
        val fingerprintIndex = col("import_fingerprint")
        session.put(
            "importFingerprint",
            if (cursor.isNull(fingerprintIndex)) JSONObject.NULL else cursor.getString(fingerprintIndex)
        )
        return session
    }

    private fun isoNow(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }

    private fun parseIso(iso: String): Long = try {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        sdf.parse(iso)?.time ?: System.currentTimeMillis()
    } catch (e: Exception) {
        System.currentTimeMillis()
    }
}
