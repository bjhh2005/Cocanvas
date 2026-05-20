package com.cocanvas.config;

import com.cocanvas.ws.CollabWebSocketHandler;
import com.cocanvas.ws.EchoWebSocketHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.lang.NonNull;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    @NonNull private final EchoWebSocketHandler echoWebSocketHandler;
    @NonNull private final CollabWebSocketHandler collabWebSocketHandler;

    public WebSocketConfig(@NonNull EchoWebSocketHandler echoWebSocketHandler,
                           @NonNull CollabWebSocketHandler collabWebSocketHandler) {
        this.echoWebSocketHandler = echoWebSocketHandler;
        this.collabWebSocketHandler = collabWebSocketHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(echoWebSocketHandler, "/ws/echo")
                .setAllowedOrigins("*");
        registry.addHandler(collabWebSocketHandler, "/ws/collab")
                .setAllowedOrigins("*");
    }
}
