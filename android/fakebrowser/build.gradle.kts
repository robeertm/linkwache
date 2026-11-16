// Test helper for the emulator tests only: a stand-in "real browser" that records which
// link it was asked to open. Never shipped.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.linkwache.fakebrowser"
    compileSdk = 36
    defaultConfig {
        applicationId = "app.linkwache.fakebrowser"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    lint { abortOnError = false }
}

kotlin { jvmToolchain(17) }
