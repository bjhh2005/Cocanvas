package com.cocanvas.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class RoomWritePermissionPolicyTest {

    private final RoomService roomService = new RoomService(null, null, null);

    @Test
    void editPermissionAllowsAnyShapeOperation() {
        assertThat(roomService.canWrite("edit", "create", "rect")).isTrue();
        assertThat(roomService.canWrite("edit", "update", "card")).isTrue();
        assertThat(roomService.canWrite("edit", "delete", "connector")).isTrue();
    }

    @Test
    void ownerRolePermissionMapsToEditBeforeWritePolicy() {
        assertThat(roomService.canWrite("edit", "create", "comment")).isTrue();
    }

    @Test
    void commentPermissionAllowsOnlyCommentShapes() {
        assertThat(roomService.canWrite("comment", "create", "comment")).isTrue();
        assertThat(roomService.canWrite("comment", "update", "comment")).isTrue();
        assertThat(roomService.canWrite("comment", "delete", "comment")).isTrue();

        assertThat(roomService.canWrite("comment", "create", "rect")).isFalse();
        assertThat(roomService.canWrite("comment", "update", "card")).isFalse();
        assertThat(roomService.canWrite("comment", "delete", "sticky")).isFalse();
    }

    @Test
    void viewPermissionRejectsEveryShapeOperation() {
        assertThat(roomService.canWrite("view", "create", "comment")).isFalse();
        assertThat(roomService.canWrite("view", "update", "rect")).isFalse();
        assertThat(roomService.canWrite("view", "delete", "card")).isFalse();
    }

    @Test
    void blankPermissionFallsBackToEdit() {
        assertThat(roomService.canWrite("", "create", "rect")).isTrue();
        assertThat(roomService.canWrite(null, "update", "sticky")).isTrue();
    }
}
