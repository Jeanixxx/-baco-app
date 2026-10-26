import org.gradle.api.tasks.Copy

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "mx.abaco.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "mx.abaco.app"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation("androidx.core:core-ktx:1.15.0")
}

// Fuentes web separadas: se copian juntas para mantener rutas relativas en WebView.
tasks.register<Copy>("copyAbacoWebAssets") {
    from(rootProject.file("index.html"))
    from(rootProject.file("styles.css"))
    from(rootProject.file("js")) { into("js") }
    into(layout.projectDirectory.dir("src/main/assets"))
}

tasks.named("preBuild") {
    dependsOn("copyAbacoWebAssets")
}
