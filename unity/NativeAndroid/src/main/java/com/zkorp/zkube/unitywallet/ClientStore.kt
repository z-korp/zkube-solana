package com.zkorp.zkube.unitywallet

import android.content.Context
import android.util.Base64

// Public locators and signed transaction journals are separate from credentials.
// Synchronous commit is the durable boundary before a caller submits bytes.
object ClientStore {
    private val fields = setOf("campaign", "daily", "session", "journal")
    private fun key(owner: String, field: String): String {
        require(owner.length == 44 && Base64.decode(owner, Base64.NO_WRAP).size == 32)
        require(field in fields)
        return "$owner:$field"
    }
    @JvmStatic fun read(context: Context, owner: String, field: String): String? =
        context.getSharedPreferences("zkube-unity-public-v1", Context.MODE_PRIVATE).getString(key(owner, field), null)
    @JvmStatic @Synchronized fun compareExchange(context: Context, owner: String, field: String, expected: String?, value: String?): Boolean {
        if (read(context, owner, field) != expected) return false
        require(value == null || value.length <= 16384)
        val editor = context.getSharedPreferences("zkube-unity-public-v1", Context.MODE_PRIVATE).edit()
        val name = key(owner, field)
        if (value == null) editor.remove(name) else editor.putString(name, value)
        check(editor.commit())
        return true
    }
}
