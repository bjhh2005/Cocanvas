package com.cocanvas.controller;

import com.cocanvas.service.HistoryService;
import com.cocanvas.service.RoomService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HistoryController {

    private final HistoryService historyService;
    private final RoomService roomService;

    public HistoryController(HistoryService historyService, RoomService roomService) {
        this.historyService = historyService;
        this.roomService = roomService;
    }

    @GetMapping({"/api/rooms/{roomId}/history", "/rooms/{roomId}/history"})
    public HistoryService.HistoryResponse history(
            @PathVariable String roomId,
            @RequestParam(defaultValue = "9223372036854775807") long at
    ) {
        return historyService.history(roomId, at);
    }

    @GetMapping({"/api/rooms/{roomId}/history/anchors", "/rooms/{roomId}/history/anchors"})
    public HistoryService.HistoryAnchors anchors(@PathVariable String roomId) {
        long roomCreatedAt = roomService.findRoom(roomId)
                .map(r -> r.getCreatedAt())
                .orElse(0L);
        return historyService.anchors(roomId, roomCreatedAt);
    }
}
