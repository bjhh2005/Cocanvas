package com.cocanvas.controller;

import com.cocanvas.service.HistoryService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HistoryController {

    private final HistoryService historyService;

    public HistoryController(HistoryService historyService) {
        this.historyService = historyService;
    }

    @GetMapping({"/api/rooms/{roomId}/history", "/rooms/{roomId}/history"})
    public HistoryService.HistoryResponse history(
            @PathVariable String roomId,
            @RequestParam(defaultValue = "9223372036854775807") long at
    ) {
        return historyService.history(roomId, at);
    }
}
