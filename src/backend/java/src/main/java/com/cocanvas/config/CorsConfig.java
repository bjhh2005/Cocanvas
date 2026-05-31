package com.cocanvas.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig {

    @Bean
    public WebMvcConfigurer corsConfigurer() {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/**")
                        .allowedOriginPatterns(
                                "http://localhost:*",
                                "http://127.0.0.1:*",
                                // 局域网常见私有网段，便于其他设备通过局域网 IP 访问
                                "http://192.168.*.*:*",
                                "http://10.*.*.*:*",
                                "http://172.16.*.*:*",
                                "http://172.17.*.*:*",
                                "http://172.18.*.*:*",
                                "http://172.19.*.*:*",
                                "http://172.2*.*.*:*",
                                "http://172.30.*.*:*",
                                "http://172.31.*.*:*"
                        )
                        .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                        .allowedHeaders("*")
                        .allowCredentials(true);
            }
        };
    }
}
