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
};

export type OverlayConfiguration = {
    normalizedScreenSize?: {
        width: number;
        height: number;
    };
    textOverlay?: {
        enabled: boolean;
        text: string;
        positionX: number;
        positionY: number;
    }[];
    dateTimeOverlay?: {
        enabled: boolean;
        positionX: number;
        positionY: number;
        dateFormat: string; // e.g: "DD-MM-YYYY"
        timeFormat: string; // e.g: "24hour"
        displayWeek: boolean;
    };
    channelNameOverlay?: {
        enabled: boolean;
    };
    style?: {
        fontSize: string; // e.g: "32*32"
        alignment: 'customize' | 'alignRight' | 'alignLeft';
    };
};
