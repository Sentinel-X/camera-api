import { BaseImageQualityConfiguration } from '../../types.js';

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


export type FieldDetectionRegion = {
    id?: number | string;
    RegionCoordinatesList?: {
        RegionCoordinates?: unknown | unknown[];
    };
};

export type RecordingScheduleConfiguration = {
    channelId: number;
    enabled: boolean;
    overwriteOldestRecords: boolean;
    schedule: {
        monday: {
            start: string; // e.g: "00:00:00"
            end: string; // e.g: "24:00:00"
            record: boolean;
        }
        tuesday: {
            start: string; // e.g: "00:00:00"
            end: string; // e.g: "24:00:00"
            record: boolean;
        }
        wednesday: {
            start: string; // e.g: "00:00:00"
            end: string; // e.g: "24:00:00"
            record: boolean;
        }
        thursday: {
            start: string; // e.g: "00:00:00"
            end: string; // e.g: "24:00:00"
            record: boolean;
        }
        friday: {
            start: string; // e.g: "00:00:00"
            end: string; // e.g: "24:00:00"
            record: boolean;
        }
        saturday: {
            start: string; // e.g: "00:00:00"
            end: string; // e.g: "24:00:00"
            record: boolean;
        }
        sunday: {
            start: string; // e.g: "00:00:00"
            end: string; // e.g: "24:00:00"
            record: boolean;
        }
    },
}

export type Hdd = {
    id: number;
    capacity: number;
    freeSpace: number;
};

export type SetStorageQuotaOptions = {
    hddId?: number;
    videoQuotaRatio: number; // 0 to 100
    pictureQuotaRatio: number; // 0 to 100
};

export type Capabilities = {
    defocus: boolean;
    sceneChange: boolean;
};

export type DefocusConfiguration = {
    enabled: boolean;
    sensitivityLevel: number; // 1 to 100
};

export type DefocusTriggerConfiguration = {
    surveillanceCenter: boolean;
    io: boolean;
    email: boolean;
};


export type SceneChangeConfiguration = {
    enabled: boolean;
    sensitivityLevel: number; // 1 to 100
};

export type SceneChangeTriggerConfiguration = {
    surveillanceCenter: boolean;
    email: boolean;
};
