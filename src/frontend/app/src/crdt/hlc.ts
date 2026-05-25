type HlcParts = {
  physicalMs: number;
  logicalCounter: number;
  nodeId: string;
};

export class HybridLogicalClock {
  private lastPhysicalMs = Date.now();
  private logicalCounter = 0;
  private readonly nodeId: string;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  now() {
    const physicalMs = Date.now();
    if (physicalMs > this.lastPhysicalMs) {
      this.lastPhysicalMs = physicalMs;
      this.logicalCounter = 0;
    } else {
      this.logicalCounter += 1;
    }

    return this.format(this.lastPhysicalMs, this.logicalCounter);
  }

  update(remoteHlc: string) {
    const remote = parseHlc(remoteHlc);
    const physicalMs = Date.now();
    const maxPhysicalMs = Math.max(physicalMs, this.lastPhysicalMs, remote.physicalMs);

    if (maxPhysicalMs === this.lastPhysicalMs && maxPhysicalMs === remote.physicalMs) {
      this.logicalCounter = Math.max(this.logicalCounter, remote.logicalCounter) + 1;
    } else if (maxPhysicalMs === this.lastPhysicalMs) {
      this.logicalCounter += 1;
    } else if (maxPhysicalMs === remote.physicalMs) {
      this.logicalCounter = remote.logicalCounter + 1;
    } else {
      this.logicalCounter = 0;
    }

    this.lastPhysicalMs = maxPhysicalMs;
    return this.format(this.lastPhysicalMs, this.logicalCounter);
  }

  private format(physicalMs: number, logicalCounter: number) {
    return `${physicalMs}.${logicalCounter}.${this.nodeId}`;
  }
}

export const parseHlc = (hlc?: string): HlcParts => {
  if (!hlc) {
    return { physicalMs: 0, logicalCounter: 0, nodeId: '' };
  }

  const [physicalMs, logicalCounter, nodeId] = hlc.split('.', 3);
  return {
    physicalMs: Number(physicalMs) || 0,
    logicalCounter: Number(logicalCounter) || 0,
    nodeId: nodeId ?? '',
  };
};

export const compareHlc = (left?: string, right?: string) => {
  const a = parseHlc(left);
  const b = parseHlc(right);

  if (a.physicalMs !== b.physicalMs) {
    return a.physicalMs - b.physicalMs;
  }

  if (a.logicalCounter !== b.logicalCounter) {
    return a.logicalCounter - b.logicalCounter;
  }

  return a.nodeId.localeCompare(b.nodeId);
};
