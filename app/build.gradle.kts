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
    implementation("androidx.biometric:biometric:1.1.0")
}

// El HTML raíz es la única fuente de interfaz: Gradle lo copia al paquete Android.
tasks.register<Copy>("copyAbacoHtml") {
    from(rootProject.file("Abaco_Gestor_Finanzas.html"))
    into(layout.projectDirectory.dir("src/main/assets"))
    rename { "index.html" }
}

tasks.named("preBuild") {
    dependsOn("copyAbacoHtml")
}
