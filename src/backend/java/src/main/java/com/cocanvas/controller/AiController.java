package com.cocanvas.controller;

import com.cocanvas.service.AiService;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AiController {

    private final AiService aiService;

    public AiController(AiService aiService) {
        this.aiService = aiService;
    }

    @PostMapping({"/api/rooms/{roomId}/ai/chat", "/rooms/{roomId}/ai/chat"})
    public AiService.AiChatResponse chat(
            @PathVariable String roomId,
            @RequestBody AiService.AiChatRequest request
    ) {
        return aiService.chat(request);
    }

    @PostMapping({"/api/rooms/{roomId}/ai/orchestrate", "/rooms/{roomId}/ai/orchestrate"})
    public AiService.AiChatResponse orchestrate(
            @PathVariable String roomId,
            @RequestBody AiService.AiChatRequest request
    ) {
        return aiService.orchestrate(request);
    }

    @PostMapping({"/api/rooms/{roomId}/ai/summarize", "/rooms/{roomId}/ai/summarize"})
    public AiService.AiSummaryResponse summarize(
            @PathVariable String roomId,
            @RequestBody AiService.AiChatRequest request
    ) {
        return aiService.summarize(request);
    }
}
