import { BaseImageQualityConfiguration } from "../../types.js";

export type ImageQualityConfiguration = BaseImageQualityConfiguration & {
    smartCodec?: boolean;
    bitrate?: {
        constant: number;
        variableCap: number;
        variableAverage: number;
    }
};

export type TimeConfiguration = {
    ntp: {
        enabled: boolean;
        server?: string;
        port?: number;
        interval?: number; // in minutes 0 to 1440 (0 = no calibration)
    };
    timezone: string; // e.g: "GMT-4:30 || GMT+4:00 || GMT-10:00"
    dst?: {
        enabled: boolean;
    }
};

