package com.cocanvas.cluster;

import java.util.List;

public interface NodeRegistry {

    List<NodeInfo> aliveNodes();
}
