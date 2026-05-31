package com.cocanvas.controller;

import com.cocanvas.service.AuthService;
import com.cocanvas.service.AuthService.AuthException;
import com.cocanvas.service.AuthService.LoginCommand;
import com.cocanvas.service.AuthService.LoginResult;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping({"/api/auth/login", "/auth/login"})
    public LoginResult login(@RequestBody LoginRequest request) {
        return authService.login(new LoginCommand(
                request.username(),
                request.password(),
                request.displayName(),
                request.color()
        ));
    }

    @GetMapping({"/api/auth/me", "/auth/me"})
    public LoginResult me(@RequestHeader(value = "Authorization", required = false) String authorization) {
        return authService.authenticateHeader(authorization)
                .map(user -> new LoginResult(user.userId(), user.username(), user.displayName(), user.color(), ""))
                .orElseThrow(() -> new AuthException("登录已过期，请重新登录"));
    }

    @ExceptionHandler(AuthException.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    public ErrorResponse handleAuth(AuthException ex) {
        return new ErrorResponse(ex.getMessage());
    }

    public record LoginRequest(String username, String password, String displayName, String color) {}

    public record ErrorResponse(String message) {}
}
