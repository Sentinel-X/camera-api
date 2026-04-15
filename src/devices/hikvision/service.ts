import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { BaseDevice } from "../base.js";
import { HttpRequestError, MissingConfigurationError } from "../../errors.js";
import { DeviceConfiguration, InvasionAreaCoordinate } from "../../types.js";
import { ImageQualityConfiguration } from "./types.js";

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

export class HikvisionDevice extends BaseDevice {
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

    async setImageQualityConfiguration(configuration: ImageQualityConfiguration): Promise<{ needsReboot: boolean }> {
        let needsReboot = false;

        const channels = await this.getCameraChannels();
        if (!channels?.StreamingChannelList?.StreamingChannel || !channels.StreamingChannelList.StreamingChannel) {
            throw new MissingConfigurationError();
        }

        // If the cameras has only one channel
        if (!Array.isArray(channels.StreamingChannelList.StreamingChannel)) {
            channels.StreamingChannelList.StreamingChannel = [channels.StreamingChannelList.StreamingChannel];
        }

        for (const channel of channels.StreamingChannelList.StreamingChannel) {
            // Some cameras have the Channel ID 101 as 1
            if (![1, 101, 201, 301, 401].includes(Number(channel.id))) {
                continue;
            }

            const channelData = await this.getCameraChannel(Number(channel.id));

            let changed = false;
            const codec = channelData.StreamingChannel.Video.videoCodecType;
            const smartCodec = channelData.StreamingChannel.Video.SmartCodec;
            const fps = channelData.StreamingChannel.Video.maxFrameRate;
            const width = channelData.StreamingChannel.Video.videoResolutionWidth;
            const height = channelData.StreamingChannel.Video.videoResolutionHeight;
            const constantBitRate = channelData.StreamingChannel.Video.constantBitRate;
            const vbrUpperCap = channelData.StreamingChannel.Video.vbrUpperCap;
            const vbrAverageCap = channelData.StreamingChannel.Video.vbrAverageCap;
            const channelName = channelData.StreamingChannel.channelName;

            if (typeof this.configuration.serialNumber === 'string' && channelName) {
                if ([1, 101].includes(channel.id) && channelName !== this.configuration.serialNumber) {
                    changed = true;
                    channelData.StreamingChannel.channelName = this.configuration.serialNumber;
                }
            }

            if (typeof configuration.compression === 'string' && codec) {
                const cameraCodec = configuration.compression === 'h264' ? 'H.264' : 'H.265';

                if (codec !== cameraCodec) {
                    changed = true;
                    channelData.StreamingChannel.Video.videoCodecType = cameraCodec;

                    if (cameraCodec === 'H.264') {
                        delete channelData.StreamingChannel.Video.H265Profile;
                        channelData.StreamingChannel.Video.H264Profile = 'Main';
                    } else {
                        delete channelData.StreamingChannel.Video.H264Profile;
                        channelData.StreamingChannel.Video.H265Profile = 'Main';
                    }
                }
            }

            if (typeof configuration.fps === 'number' && fps && configuration.fps * 100 !== Number(fps)) {
                changed = true;
                channelData.StreamingChannel.Video.maxFrameRate = configuration.fps * 100;
            }


            if (configuration.resolution) {
                if (width && width !== configuration.resolution.width) {
                    changed = true;
                    channelData.StreamingChannel.Video.videoResolutionWidth = configuration.resolution.width;
                }

                if (height && height !== configuration.resolution.height) {
                    changed = true;
                    channelData.StreamingChannel.Video.videoResolutionHeight = configuration.resolution.height;
                }
            }

            if (configuration.bitrate?.constant && constantBitRate && configuration.bitrate.constant !== Number(constantBitRate)) {
                changed = true;
                channelData.StreamingChannel.Video.constantBitRate = configuration.bitrate.constant;
            }

            if (configuration.bitrate?.variableCap && vbrUpperCap && configuration.bitrate.variableCap !== Number(vbrUpperCap)) {
                changed = true;
                channelData.StreamingChannel.Video.vbrUpperCap = configuration.bitrate.variableCap;
            }

            if (configuration.bitrate?.variableAverage && vbrAverageCap && configuration.bitrate.variableAverage !== Number(vbrAverageCap)) {
                changed = true;
                channelData.StreamingChannel.Video.vbrAverageCap = configuration.bitrate.variableAverage;
            }


            if (changed) {
                const rebootRequired = await this.updateCameraChannel(channel.id, channelData);
                needsReboot = needsReboot || rebootRequired;
            }

            // Some cameras do not allow to change to H.265 and enable H.265+ at the same time.
            if (typeof configuration.smartCodec === 'boolean' && channelData.StreamingChannel.Video.videoCodecType === 'H.265' && smartCodec) {
                channelData.StreamingChannel.Video.SmartCodec = { enabled: configuration.smartCodec };

                const rebootRequired = await this.updateCameraChannel(channel.id, channelData);
                needsReboot = needsReboot || rebootRequired;
            }
        }

        return { needsReboot };
    }

    public async reboot() {
        const resp = await this.getDigestClient().fetch(
            this.buildURL(`/ISAPI/System/reboot`),
            {
                method: 'put',
                signal: this.timeoutSignal
            }
        );

        if (resp.status !== 200) {
            throw new HttpRequestError();
        }

        const res = this.xmlParser.parse(await resp.text());
        if (Number(res?.ResponseStatus?.statusCode) !== 1 || res?.ResponseStatus?.subStatusCode !== 'ok') {
            throw new HttpRequestError();
        }

        return res;
    }

    private async getCameraChannels() {
        const res = await this.getDigestClient().fetch(
            this.buildURL(`/ISAPI/Streaming/channels`),
            {
                signal: this.timeoutSignal
            }
        );

        if (res.status !== 200) {
            throw new HttpRequestError();
        }

        return this.xmlParser.parse(await res.text());
    }

    private async getCameraChannel(channelId: number) {
        const res = await this.getDigestClient().fetch(
            this.buildURL(`/ISAPI/Streaming/channels/${channelId}`),
            {
                signal: this.timeoutSignal
            }
        );

        if (res.status !== 200) {
            throw new HttpRequestError();
        }

        return this.xmlParser.parse(await res.text());
    }

    private async updateCameraChannel(channelId: number, channelData: Record<string, unknown>) {
        const resp = await this.getDigestClient().fetch(
            this.buildURL(`/ISAPI/Streaming/channels/${channelId}`),
            {
                method: 'put',
                headers: {
                    'content-type': 'application/xml',
                },
                body: this.xmlBuilder.build(channelData),
                signal: this.timeoutSignal
            }
        );

        if (resp.status !== 200) {
            throw new HttpRequestError();
        }

        const res = this.xmlParser.parse(await resp.text());
        if (
            !(Number(res?.ResponseStatus?.statusCode) === 7 && res?.ResponseStatus?.subStatusCode === 'rebootRequired') &&
            !(Number(res?.ResponseStatus?.statusCode) === 1 && (res?.ResponseStatus?.subStatusCode?.toLowerCase() === 'ok' || res?.ResponseStatus?.statusString?.toLowerCase() === 'ok'))
        ) {
            throw new HttpRequestError();
        }

        const shouldReboot = Number(res?.ResponseStatus?.statusCode) === 7 && res?.ResponseStatus?.subStatusCode === 'rebootRequired';
        return shouldReboot;
    }
}
