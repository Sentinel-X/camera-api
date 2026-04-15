export type DeviceConfiguration = {
    ipOrHttpAddress: string;
    port: number;
    username: string;
    password: string;
    serialNumber?: string | null;
    retryCount?: number;
    retryDelay?: number;
    timeout?: number;
}

export type DigestClientOptions = {
    client?: unknown;
}

export type InvasionAreaCoordinate = {
    x: number;
    y: number;
}

export type BaseImageQualityConfiguration = {
    compression?: 'h264' | 'h265';
    fps?: number;
    resolution?: {
        width: number;
        height: number;
    };
    bitrate?: {
        constant: number;
    }
};
