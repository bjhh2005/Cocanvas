# syntax=docker/dockerfile:1.7

FROM eclipse-temurin:21-jdk AS build

WORKDIR /workspace

ARG GRADLE_PROXY_HOST=
ARG GRADLE_PROXY_PORT=

COPY gradlew gradlew.bat settings.gradle.kts build.gradle.kts ./
COPY gradle ./gradle

RUN chmod +x ./gradlew

# Warm Gradle wrapper and runtime dependencies before copying source code.
# With BuildKit cache, changing Java source files will not force dependencies
# to be downloaded again.
RUN --mount=type=cache,target=/root/.gradle \
    if [ -n "$GRADLE_PROXY_HOST" ] && [ -n "$GRADLE_PROXY_PORT" ]; then \
      export JAVA_TOOL_OPTIONS="-Dhttp.proxyHost=$GRADLE_PROXY_HOST -Dhttp.proxyPort=$GRADLE_PROXY_PORT -Dhttps.proxyHost=$GRADLE_PROXY_HOST -Dhttps.proxyPort=$GRADLE_PROXY_PORT -Dhttp.nonProxyHosts=localhost|127.*|[::1]|host.docker.internal"; \
    fi; \
    ./gradlew dependencies --configuration runtimeClasspath --no-daemon || true

COPY src ./src

RUN --mount=type=cache,target=/root/.gradle \
    if [ -n "$GRADLE_PROXY_HOST" ] && [ -n "$GRADLE_PROXY_PORT" ]; then \
      export JAVA_TOOL_OPTIONS="-Dhttp.proxyHost=$GRADLE_PROXY_HOST -Dhttp.proxyPort=$GRADLE_PROXY_PORT -Dhttps.proxyHost=$GRADLE_PROXY_HOST -Dhttps.proxyPort=$GRADLE_PROXY_PORT -Dhttp.nonProxyHosts=localhost|127.*|[::1]|host.docker.internal"; \
    fi; \
    ./gradlew bootJar --no-daemon

FROM eclipse-temurin:21-jre

WORKDIR /app

COPY --from=build /workspace/build/libs/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
