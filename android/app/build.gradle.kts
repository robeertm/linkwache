import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// One version for the whole repository: the app follows package.json.
@Suppress("UNCHECKED_CAST")
val repoVersion: String = providers.gradleProperty("versionOverride").orNull
    ?: ((JsonSlurper().parse(rootProject.file("../package.json")) as Map<String, Any>)["version"] as String)

fun versionCodeOf(v: String): Int {
    val p = v.split('.').map { it.toInt() }
    require(p.size == 3 && p[1] < 100 && p[2] < 100) { "version $v" }
    return p[0] * 10000 + p[1] * 100 + p[2]
}

// Default server address, set at build time (empty = the setup assistant asks for one).
val defaultServer: String = (System.getenv("LINKWACHE_DEFAULT_SERVER") ?: providers.gradleProperty("defaultServer").orNull ?: "").trim()
// Earlier default addresses that installations still following the default move away from.
val presetMigrateFrom: String = (System.getenv("LINKWACHE_PRESET_MIGRATE_FROM") ?: providers.gradleProperty("presetMigrateFrom").orNull ?: "").trim()

android {
    namespace = "app.linkwache.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.linkwache.android"
        minSdk = 26
        targetSdk = 36
        versionName = repoVersion
        versionCode = versionCodeOf(repoVersion)
        buildConfigField("String", "DEFAULT_SERVER", "\"" + defaultServer.replace("\"", "") + "\"")
        buildConfigField("String", "PRESET_MIGRATE_FROM", "\"" + presetMigrateFrom.replace("\"", "").replace("\\", "").replace(Regex("\\s+"), " ") + "\"")
        buildConfigField("String", "UPDATE_REPO", "\"robeertm/linkwache\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Unsigned here on purpose: the release APK is signed on the maintainer's build host
            // (android/scripts/sign-release.sh). The key never reaches CI.
            signingConfig = null
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all { it.systemProperty("linkwache.android", rootProject.projectDir.absolutePath) }
    }

    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module", "META-INF/versions/**", "DebugProbesKt.bin")
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        disable += setOf("MissingTranslation", "GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
    }

    dependenciesInfo {
        // No dependency metadata block in the APK (not needed outside app stores).
        includeInApk = false
        includeInBundle = false
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation(project(":core"))
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.1")
    implementation("androidx.browser:browser:1.8.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation(platform("androidx.compose:compose-bom:2025.06.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.15.1")
    testImplementation("androidx.test:core-ktx:1.6.1")
    testImplementation("org.json:json:20240303")
}
