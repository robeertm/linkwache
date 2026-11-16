plugins {
    id("org.jetbrains.kotlin.jvm")
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // Android ships org.json; the JVM tests need a copy.
    compileOnly("org.json:json:20240303")
    testImplementation("org.json:json:20240303")
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}

tasks.test {
    // Shared test vectors and the app's string resources live outside the module.
    systemProperty("linkwache.repo", rootProject.projectDir.parentFile.absolutePath)
    systemProperty("linkwache.android", rootProject.projectDir.absolutePath)
    testLogging { events("failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}
