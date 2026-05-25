package com.cocanvas.config;

import com.cocanvas.ws.EchoWebSocketHandler;
import com.cocanvas.ws.CollabWebSocketHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final CollabWebSocketHandler collabWebSocketHandler;
    private final EchoWebSocketHandler echoWebSocketHandler;

    public WebSocketConfig(CollabWebSocketHandler collabWebSocketHandler, EchoWebSocketHandler echoWebSocketHandler) {
        this.collabWebSocketHandler = collabWebSocketHandler;
        this.echoWebSocketHandler = echoWebSocketHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(collabWebSocketHandler, "/ws/collab")
                .setAllowedOrigins("*");
        registry.addHandler(echoWebSocketHandler, "/ws/echo")
                .setAllowedOrigins("*");
    }
}
