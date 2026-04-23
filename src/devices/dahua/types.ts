import { BaseImageQualityConfiguration } from "../../types.js";

export interface InvasionAreaPoint {
    x: number;
    y: number;
}

export type ImageQualityConfiguration = BaseImageQualityConfiguration & {
    shotQuality?: 'minimum' | 'medium' | 'maximum';
};

export type TimeConfiguration = {
    timeFormat?: string; // e.g: dd-MM-yyyy HH:mm:ss
    ntp?: {
        enabled: boolean;
        server?: string;
        port?: number;
        interval?: number; // in minutes 0 to 1440 (0 = no calibration)
    };
    timezoneName?: string; // e.g: "UTC-0" or "Brasilia"
    timeZoneId?: number; // e.g: 0 for UTC-0, 22 for Brasilia
    dst?: {
        enabled: boolean;
    }
};

export type OverlayConfiguration = {
    channelTitle?: {
        name?: string;
        encodeBlend?: boolean;
        previewBlend?: boolean;
        rect?: [number, number, number, number];
    };
    timeTitle?: {
        encodeBlend?: boolean;
        previewBlend?: boolean;
        rect?: [number, number, number, number];
        showWeek?: boolean;
    };
};
