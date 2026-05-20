package com.cocanvas.protocol;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;

public record Op(
    @JsonProperty("opType")    String opType,
    @JsonProperty("shapeId")   String shapeId,
    @JsonProperty("shapeType") String shapeType,
    @JsonProperty("attrs")     JsonNode attrs
) {}
