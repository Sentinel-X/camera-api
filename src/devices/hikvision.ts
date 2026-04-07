import { Device, DeviceConfiguration, InvasionAreaCoordinate } from "../types.js";
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { BaseDevice } from "./base.js";
import { HttpRequestError, MissingConfigurationError } from "../errors.js";

type FieldDetectionRegion = {
    id?: number | string;
    RegionCoordinatesList?: {
        RegionCoordinates?: unknown | unknown[];
    };
};

function parseDimension(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export class HikvisionDevice extends BaseDevice implements Device {
    private xmlParser;
    private xmlBuilder;

    constructor(configuration: DeviceConfiguration) {
        super(configuration);

        this.xmlParser = new XMLParser({
            ignoreAttributes: false,
        });
        this.xmlBuilder = new XMLBuilder({
            ignoreAttributes: false,
        });
    }

    async getInvasionAreaCoordinates(): Promise<InvasionAreaCoordinate[]> {
        const fieldDetectionRes = await this.getDigestClient().fetch(
            this.buildURL(`/ISAPI/Smart/FieldDetection/1`),
            {
                signal: this.timeoutSignal
            }
        );

        if (fieldDetectionRes.status !== 200) {
            throw new HttpRequestError();
        }

        const fieldDetectionConfig = this.xmlParser.parse(await fieldDetectionRes.text());
        if (!fieldDetectionConfig.FieldDetection.enabled) {
            throw new MissingConfigurationError();
        }

        let fieldDetectionRegions = fieldDetectionConfig?.FieldDetection?.FieldDetectionRegionList?.FieldDetectionRegion ?? [];
        if (!Array.isArray(fieldDetectionRegions)) {
            fieldDetectionRegions = [fieldDetectionRegions];
        }

        const regionWithArea = fieldDetectionRegions.find((region: FieldDetectionRegion) => {
            const rawCoordinates = region?.RegionCoordinatesList?.RegionCoordinates;
            const coordinates = Array.isArray(rawCoordinates)
                ? rawCoordinates
                : rawCoordinates !== undefined && rawCoordinates !== null
                    ? [rawCoordinates]
                    : [];

            return coordinates.length > 0;
        });

        if (!regionWithArea) {
            return [];
        }

        const rawCameraCoordinates = regionWithArea?.RegionCoordinatesList?.RegionCoordinates;
        const cameraCoordinates = Array.isArray(rawCameraCoordinates)
            ? rawCameraCoordinates
            : rawCameraCoordinates !== undefined && rawCameraCoordinates !== null
                ? [rawCameraCoordinates]
                : [];

        if (!cameraCoordinates.length) {
            return [];
        }

        const round = (value: number) => Math.round(value * 1e5) / 1e5; // Limit to 5 decimal places

        const drawingScreenWidth = parseDimension(fieldDetectionConfig.FieldDetection?.normalizedScreenSize?.normalizedScreenWidth, 1000);
        const drawingScreenHeight = parseDimension(fieldDetectionConfig.FieldDetection?.normalizedScreenSize?.normalizedScreenHeight, 1000);

        return cameraCoordinates.map(
            ({ positionX, positionY }: { positionX: number | string; positionY: number | string }) => ({
                x: round(Number(positionX) / drawingScreenWidth),
                y: round(1 - Number(positionY) / drawingScreenHeight) // Y axis is inverted on hikvision devices (0 = bottom, 1 = top)
            })
        );
    }

    async setInvasionAreaCoordinates(coordinates: InvasionAreaCoordinate[]) {
        const fieldDetectionRes = await this.getDigestClient().fetch(
            this.buildURL(`/ISAPI/Smart/FieldDetection/1`),
            {
                signal: this.timeoutSignal
            }
        );

        if (fieldDetectionRes.status !== 200) {
            throw new HttpRequestError();
        }

        const fieldDetectionConfig = this.xmlParser.parse(await fieldDetectionRes.text());
        if (!fieldDetectionConfig.FieldDetection.enabled) {
            throw new MissingConfigurationError();
        }

        const clampInt = (value: number, max: number) => Math.min(Math.max(Math.trunc(value), 0), max);
        const drawingScreenWidth = parseDimension(fieldDetectionConfig.FieldDetection?.normalizedScreenSize?.normalizedScreenWidth, 1000);
        const drawingScreenHeight = parseDimension(fieldDetectionConfig.FieldDetection?.normalizedScreenSize?.normalizedScreenHeight, 1000);

        const cameraCoordinates = coordinates.map(
            ({ x, y }) => ({
                positionX: clampInt(x * drawingScreenWidth, drawingScreenWidth),
                positionY: clampInt((1 - y) * drawingScreenHeight, drawingScreenHeight) // Y axis inverted on hikvision (0 = bottom, 1 = top)
            })
        );

        for (const region of fieldDetectionConfig.FieldDetection.FieldDetectionRegionList.FieldDetectionRegion) {
            if (!region.RegionCoordinatesList) {
                region.RegionCoordinatesList = { RegionCoordinates: [] };
            } else if (!Array.isArray(region.RegionCoordinatesList.RegionCoordinates)) {
                if (region.RegionCoordinatesList.RegionCoordinates) {
                    region.RegionCoordinatesList.RegionCoordinates = [region.RegionCoordinatesList.RegionCoordinates];
                } else {
                    region.RegionCoordinatesList.RegionCoordinates = [];
                }
            }

            if (Number(region.id) === 1) {
                region.RegionCoordinatesList.RegionCoordinates = cameraCoordinates;
            } else {
                region.RegionCoordinatesList.RegionCoordinates = [];
            }
        }

        const res = await this.getDigestClient().fetch(
            this.buildURL(`/ISAPI/Smart/FieldDetection/1`),
            {
                method: 'put',
                headers: {
                    'content-type': 'application/xml',
                },
                body: this.xmlBuilder.build(fieldDetectionConfig),
                signal: this.timeoutSignal
            }
        );

        if (res.status !== 200) {
            throw new HttpRequestError();
        }

        const updateRes = this.xmlParser.parse(await res.text());
        if (Number(updateRes?.ResponseStatus?.statusCode) !== 1 || updateRes?.ResponseStatus?.subStatusCode !== 'ok') {
            throw new HttpRequestError();
        }
    }
}
