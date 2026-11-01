package dev.crossbind.warm

// Kotlin, which an app extension's Android sources may be written in: compiling it here caches the Android Gradle
// plugin's Kotlin compiler and Kotlin's library for the app builds, which run offline.
internal object WarmKotlin {
    fun names(values: List<String>): List<String> = values.map { it.uppercase() }
}
