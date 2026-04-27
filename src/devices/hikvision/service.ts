import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import moment from 'moment-timezone';
import { BaseDevice } from '../base.js';
import { HttpRequestError, MissingConfigurationError } from '../../errors.js';
import { DeviceConfiguration, InvasionAreaCoordinate } from '../../types.js';
import { Capabilities, DefocusConfiguration, DefocusTriggerConfiguration, FieldDetectionRegion, Hdd, ImageQualityConfiguration, OverlayConfiguration, RecordingScheduleConfiguration, SceneChangeConfiguration, SceneChangeTriggerConfiguration, SetStorageQuotaOptions, TimeConfiguration } from './types.js';
import { parseBoolean, parseDimension } from './utils.js';

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
            this.buildURL('/ISAPI/Smart/FieldDetection/1'),
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
            this.buildURL('/ISAPI/Smart/FieldDetection/1'),
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
            this.buildURL('/ISAPI/Smart/FieldDetection/1'),
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

            if (typeof configuration.bitrate?.constant === 'number' && constantBitRate && configuration.bitrate.constant !== Number(constantBitRate)) {
                changed = true;
                channelData.StreamingChannel.Video.constantBitRate = configuration.bitrate.constant;
            }

            if (typeof configuration.bitrate?.variableCap === 'number' && vbrUpperCap && configuration.bitrate.variableCap !== Number(vbrUpperCap)) {
                changed = true;
                channelData.StreamingChannel.Video.vbrUpperCap = configuration.bitrate.variableCap;
            }

            if (typeof configuration.bitrate?.variableAverage === 'number' && vbrAverageCap && configuration.bitrate.variableAverage !== Number(vbrAverageCap)) {
                changed = true;
                channelData.StreamingChannel.Video.vbrAverageCap = configuration.bitrate.variableAverage;
            }


            if (changed) {
                const rebootRequired = await this.updateCameraChannel(channel.id, channelData);
                needsReboot = needsReboot || rebootRequired;
            }

            // Some cameras do not allow to change to H.265 and enable H.265+ at the same time.
            if (typeof configuration.smartCodec === 'boolean' && channelData.StreamingChannel.Video.videoCodecType === 'H.265' && smartCodec && smartCodec.enabled !== configuration.smartCodec) {
                channelData.StreamingChannel.Video.SmartCodec = { enabled: configuration.smartCodec };

                const rebootRequired = await this.updateCameraChannel(channel.id, channelData);
                needsReboot = needsReboot || rebootRequired;
            }
        }

        return { needsReboot };
    }

    async setTimeConfiguration(timeConfiguration: TimeConfiguration) {
        const configuration: Record<string, unknown> = {
            timeMode: timeConfiguration.ntp.enabled ? 'NTP' : 'manual',
            timeZone: timeConfiguration.timezone,
        };

        if (!timeConfiguration.ntp.enabled) {
            configuration.localTime = moment().utcOffset(timeConfiguration.timezone.replace('GMT', '')).add(1, 'seconds').format();
        }

        const updateRes = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/System/time'),
            {
                method: 'put',
                headers: {
                    'content-type': 'application/xml',
                },
                body: this.xmlBuilder.build({
                    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
                    Time: configuration
                }),
                signal: this.timeoutSignal
            }
        );

        if (updateRes.status !== 200) {
            throw new HttpRequestError();
        }

        if (timeConfiguration.ntp.enabled) {
            const updateRes = await this.getDigestClient().fetch(
                this.buildURL('/ISAPI/System/time/ntpServers/1'),
                {
                    method: 'put',
                    headers: {
                        'content-type': 'application/xml',
                    },
                    body: this.xmlBuilder.build({
                        '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
                        NTPServer: {
                            id: 1,
                            addressingFormatType: 'hostname',
                            hostName: timeConfiguration.ntp.server,
                            portNo: timeConfiguration.ntp.port,
                            synchronizeInterval: timeConfiguration.ntp.interval
                        }
                    }),
                    signal: this.timeoutSignal
                }
            );

            if (updateRes.status !== 200) {
                throw new HttpRequestError();
            }
        }
    }

    async getCurrentTime(): Promise<Date> {
        const res = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/System/time'),
            {
                signal: this.timeoutSignal
            }
        );

        if (res.status !== 200) {
            throw new HttpRequestError();
        }

        const timeData = this.xmlParser.parse(await res.text());
        const date = moment(timeData?.Time?.localTime);
        if (!date.isValid()) {
            throw new HttpRequestError('Invalid time format received from camera');
        }

        return date.toDate();
    }

    async setCurrentTime(date: Date) {
        const res = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/System/time'),
            {
                signal: this.timeoutSignal
            }
        );

        if (res.status !== 200) {
            throw new HttpRequestError();
        }

        const timeData = this.xmlParser.parse(await res.text());
        timeData.Time.localTime = moment(date).format();

        const updateRes = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/System/time'),
            {
                method: 'put',
                headers: {
                    'content-type': 'application/xml',
                },
                body: this.xmlBuilder.build(timeData),
                signal: this.timeoutSignal
            }
        );

        if (updateRes.status !== 200) {
            throw new HttpRequestError();
        }
    }

    public async reboot() {
        const resp = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/System/reboot'),
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
    }

    public async getOverlayConfiguration(channelId: number): Promise<OverlayConfiguration> {
        const res = await this.getDigestClient().fetch(
            this.buildURL(`/ISAPI/System/Video/inputs/channels/${channelId}/overlays`),
            {
                signal: this.timeoutSignal
            }
        );

        if (res.status !== 200) {
            throw new HttpRequestError();
        }

        const overlays = this.xmlParser.parse(await res.text());

        const overlay = overlays?.VideoOverlay;
        if (!overlay) {
            return {};
        }

        const textOverlays = Array.isArray(overlay?.TextOverlayList?.TextOverlay)
            ? overlay.TextOverlayList.TextOverlay
            : overlay?.TextOverlayList?.TextOverlay !== undefined && overlay?.TextOverlayList?.TextOverlay !== null
                ? [overlay.TextOverlayList.TextOverlay]
                : [];

        const configuration: OverlayConfiguration = {};

        if (overlay.normalizedScreenSize) {
            configuration.normalizedScreenSize = {
                width: parseDimension(overlay.normalizedScreenSize.normalizedScreenWidth, 0),
                height: parseDimension(overlay.normalizedScreenSize.normalizedScreenHeight, 0),
            };
        }

        if (textOverlays.length) {
            configuration.textOverlay = textOverlays.map((textOverlay: Record<string, unknown>) => ({
                enabled: parseBoolean(textOverlay.enabled) ?? false,
                text: typeof textOverlay.displayText === 'string' ? textOverlay.displayText : '',
                positionX: parseDimension(textOverlay.positionX, 0),
                positionY: parseDimension(textOverlay.positionY, 0),
            }));
        }

        if (overlay.DateTimeOverlay) {
            configuration.dateTimeOverlay = {
                enabled: parseBoolean(overlay.DateTimeOverlay.enabled) ?? false,
                positionX: parseDimension(overlay.DateTimeOverlay.positionX, 0),
                positionY: parseDimension(overlay.DateTimeOverlay.positionY, 0),
                dateFormat: typeof overlay.DateTimeOverlay.dateStyle === 'string' ? overlay.DateTimeOverlay.dateStyle : '',
                timeFormat: typeof overlay.DateTimeOverlay.timeStyle === 'string' ? overlay.DateTimeOverlay.timeStyle : '',
                displayWeek: parseBoolean(overlay.DateTimeOverlay.displayWeek) ?? false,
            };
        }

        if (overlay.channelNameOverlay) {
            configuration.channelNameOverlay = {
                enabled: parseBoolean(overlay.channelNameOverlay.enabled) ?? false,
            };
        }

        const alignment = overlay.alignment;
        if (
            typeof overlay.fontSize === 'string' &&
            typeof alignment === 'string' &&
            ['customize', 'alignRight', 'alignLeft'].includes(alignment)
        ) {
            configuration.style = {
                fontSize: overlay.fontSize,
                alignment: alignment as 'customize' | 'alignRight' | 'alignLeft'
            };
        }

        return configuration;
    }

    public async setOverlayConfiguration(channelId: number, configuration: OverlayConfiguration) {
        const res = await this.getDigestClient().fetch(
            this.buildURL(`/ISAPI/System/Video/inputs/channels/${channelId}/overlays`),
            {
                signal: this.timeoutSignal
            }
        );

        if (res.status !== 200) {
            throw new HttpRequestError();
        }

        const overlays = this.xmlParser.parse(await res.text());
        if (!overlays?.VideoOverlay) {
            throw new MissingConfigurationError();
        }

        const overlay = overlays.VideoOverlay;
        if (configuration.textOverlay) {
            overlay.TextOverlayList = {
                '@_size': configuration.textOverlay.length,
                TextOverlay: configuration.textOverlay.map((textOverlay, index) => ({
                    id: index + 1,
                    enabled: textOverlay.enabled,
                    positionX: textOverlay.positionX,
                    positionY: textOverlay.positionY,
                    displayText: textOverlay.text,
                }))
            };
        }

        if (configuration.dateTimeOverlay) {
            overlay.DateTimeOverlay = {
                ...(overlay.DateTimeOverlay ?? {}),
                enabled: configuration.dateTimeOverlay.enabled,
                positionX: configuration.dateTimeOverlay.positionX,
                positionY: configuration.dateTimeOverlay.positionY,
                dateStyle: configuration.dateTimeOverlay.dateFormat,
                timeStyle: configuration.dateTimeOverlay.timeFormat,
                displayWeek: configuration.dateTimeOverlay.displayWeek,
            };
        }

        if (configuration.channelNameOverlay) {
            overlay.channelNameOverlay = {
                ...(overlay.channelNameOverlay ?? {}),
                enabled: configuration.channelNameOverlay.enabled,
            };
        }

        if (configuration.style) {
            overlay.fontSize = configuration.style.fontSize;
            overlay.alignment = configuration.style.alignment;
        }

        const updateRes = await this.getDigestClient().fetch(
            this.buildURL(`/ISAPI/System/Video/inputs/channels/${channelId}/overlays`),
            {
                method: 'put',
                headers: {
                    'content-type': 'application/xml',
                },
                body: this.xmlBuilder.build(overlays),
                signal: this.timeoutSignal
            }
        );

        if (updateRes.status !== 200) {
            throw new HttpRequestError();
        }

        const updatePayload = this.xmlParser.parse(await updateRes.text());
        if (Number(updatePayload?.ResponseStatus?.statusCode) !== 1 || updatePayload?.ResponseStatus?.subStatusCode !== 'ok') {
            throw new HttpRequestError();
        }
    }

    public async setRecordingScheduleConfiguration(recordingScheduleConfiguration: RecordingScheduleConfiguration[]) {
        const resp = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/ContentMgmt/record/tracks'),
            {
                signal: this.timeoutSignal
            }
        );

        if (resp.status !== 200) {
            throw new HttpRequestError();
        }

        const schedule = this.xmlParser.parse(await resp.text());

        if (!Array.isArray(schedule.TrackList.Track)) {
            schedule.TrackList.Track = [schedule.TrackList.Track];
        }

        const previousSchedule = JSON.stringify(schedule);

        for (const track of schedule.TrackList.Track) {
            const newConfig = recordingScheduleConfiguration.find(config => config.channelId === Number(track.id));
            if (!newConfig) {
                continue;
            }

            const scheduleBlock = track?.TrackSchedule?.ScheduleBlockList?.ScheduleBlock ?? track?.TrackSchedule?.ScheduleBlock;
            if (!scheduleBlock) {
                throw new MissingConfigurationError();
            }

            if (!Array.isArray(scheduleBlock.ScheduleAction)) {
                scheduleBlock.ScheduleAction = [];
            }

            const scheduleKeys: Array<keyof RecordingScheduleConfiguration['schedule']> = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

            const cameraWeekdaysLabel = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            for (let i = 0; i < 7; i++) {
                if (!scheduleBlock.ScheduleAction[i]) {
                    scheduleBlock.ScheduleAction[i] = {
                        id: i + 1, // Starts from 1 to 7. Monday being 1 and Sunday being 7
                    };
                }

                const daySchedule = newConfig.schedule[scheduleKeys[i]];

                scheduleBlock.ScheduleAction[i] = {
                    ...scheduleBlock.ScheduleAction[i],
                    ScheduleActionStartTime: {
                        DayOfWeek: cameraWeekdaysLabel[i],
                        TimeOfDay: daySchedule.start
                    },
                    ScheduleActionEndTime: {
                        DayOfWeek: cameraWeekdaysLabel[i],
                        TimeOfDay: daySchedule.end
                    },
                    ScheduleDSTEnable: false,
                    Actions: { Record: daySchedule.record, ActionRecordingMode: 'CMR' }
                };
            }

            track.Enable = newConfig.enabled;
            track.CustomExtensionList.CustomExtension.enableSchedule = newConfig.enabled;
            track.LoopEnable = newConfig.overwriteOldestRecords;

            if (track?.TrackSchedule?.ScheduleBlockList?.ScheduleBlock) {
                track.TrackSchedule.ScheduleBlockList.ScheduleBlock = scheduleBlock;
            } else {
                track.TrackSchedule.ScheduleBlock = scheduleBlock;
            }
        }

        if (previousSchedule === JSON.stringify(schedule)) {
            return;
        }

        const updateResp = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/ContentMgmt/record/tracks'),
            {
                method: 'put',
                headers: {
                    'content-type': 'application/xml',
                },
                body: this.xmlBuilder.build(schedule),
                signal: this.timeoutSignal
            }
        );

        if (updateResp.status !== 200) {
            throw new HttpRequestError();
        }

        const updateRes = this.xmlParser.parse(await updateResp.text());
        if (Number(updateRes?.ResponseStatus?.statusCode) !== 1 || updateRes?.ResponseStatus?.subStatusCode !== 'ok') {
            throw new HttpRequestError();
        }
    }

    public async getHddList(): Promise<Hdd[]> {
        const res = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/ContentMgmt/Storage/hdd'),
            {
                signal: this.timeoutSignal
            }
        );

        if (res.status !== 200) {
            throw new HttpRequestError();
        }

        const payload = this.xmlParser.parse(await res.text());
        const rawHddList = payload?.hddList?.hdd;

        const hdds = Array.isArray(rawHddList)
            ? rawHddList
            : rawHddList !== undefined && rawHddList !== null
                ? [rawHddList]
                : [];

        return hdds.map((hdd: Record<string, unknown>) => ({
            id: Number(hdd.id),
            capacity: Number(hdd.capacity),
            freeSpace: Number(hdd.freeSpace),
        }));
    }

    public async setStorageQuota(options: SetStorageQuotaOptions) {
        const res = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/ContentMgmt/Storage/quota' + (options.hddId !== undefined ? `/${options.hddId}` : '')),
            {
                signal: this.timeoutSignal
            }
        );

        if (res.status !== 200) {
            throw new HttpRequestError();
        }

        const storageQuota = this.xmlParser.parse(await res.text());
        const quota = storageQuota.diskQuotaList?.diskQuota ?? storageQuota.diskQuota;

        if (quota.videoQuotaRatio !== options.videoQuotaRatio || quota.pictureQuotaRatio !== options.pictureQuotaRatio) {
            quota.videoQuotaRatio = options.videoQuotaRatio;
            quota.pictureQuotaRatio = options.pictureQuotaRatio;

            const resp = await this.getDigestClient().fetch(
                this.buildURL(`/ISAPI/ContentMgmt/Storage/quota${options.hddId !== undefined ? `/${options.hddId}` : ''}`),
                {
                    method: 'put',
                    headers: {
                        'content-type': 'application/xml',
                    },
                    body: this.xmlBuilder.build(storageQuota),
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
        }
    }

    public async getCapabilities(): Promise<Capabilities> {
        const res = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/System/capabilities'),
            {
                signal: this.timeoutSignal
            }
        );

        if (res.status !== 200) {
            throw new HttpRequestError();
        }

        const capabilities = this.xmlParser.parse(await res.text()).DeviceCap;

        return {
            defocus: parseBoolean(capabilities?.SmartCap?.isSupportDefocusDetection) ?? false,
            sceneChange: parseBoolean(capabilities?.SmartCap?.isSupportSceneChangeDetection) ?? false,
        };
    }

    public async setDefocusConfiguration(config: DefocusConfiguration) {
        const defocusRes = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/Smart/DefocusDetection/1'),
            {
                signal: this.timeoutSignal
            }
        );

        if (defocusRes.status !== 200) {
            throw new HttpRequestError();
        }

        const defocusDetectionConfig = this.xmlParser.parse(await defocusRes.text());
        const previousDefocusDetectionConfig = JSON.stringify(defocusDetectionConfig);

        defocusDetectionConfig.DefocusDetection.enabled = config.enabled;
        defocusDetectionConfig.DefocusDetection.sensitivityLevel = config.sensitivityLevel;

        if (previousDefocusDetectionConfig === JSON.stringify(defocusDetectionConfig)) {
            return;
        }

        const res = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/Smart/DefocusDetection/1'),
            {
                method: 'put',
                headers: {
                    'content-type': 'application/xml',
                },
                body: this.xmlBuilder.build(defocusDetectionConfig),
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

    public async setDefocusTriggerConfiguration(config: DefocusTriggerConfiguration) {
        const defocusTriggerRes = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/Event/triggers/defocus-1'),
            {
                signal: this.timeoutSignal
            }
        );

        if (defocusTriggerRes.status !== 200) {
            throw new HttpRequestError();
        }

        const defocusTriggerConfig = this.xmlParser.parse(await defocusTriggerRes.text());
        const previousDefocusTriggerConfig = JSON.stringify(defocusTriggerConfig);

        if (!defocusTriggerConfig.EventTrigger.EventTriggerNotificationList) {
            defocusTriggerConfig.EventTrigger.EventTriggerNotificationList = {};
        }

        if (!defocusTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification) {
            defocusTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification = [];
        } else if (!Array.isArray(defocusTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification)) {
            defocusTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification = [defocusTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification];
        }

        if (!config.email) {
            defocusTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification = defocusTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification.filter(
                (notification: Record<string, unknown>) => notification.notificationMethod !== 'email'
            );
        }

        if (!config.io) {
            defocusTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification = defocusTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification.filter(
                (notification: Record<string, unknown>) => notification.notificationMethod !== 'IO'
            );
        }

        if (!config.surveillanceCenter) {
            defocusTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification = defocusTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification.filter(
                (notification: Record<string, unknown>) => notification.notificationMethod !== 'center'
            );
        }

        if (config.surveillanceCenter) {
            defocusTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification.push({
                id: 'center',
                notificationMethod: 'center',
                notificationRecurrence: 'beginning'
            });
        }

        if (config.email) {
            defocusTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification.push({
                id: 'email',
                notificationMethod: 'email',
                notificationRecurrence: 'beginning'
            });
        }

        if (config.io) {
            defocusTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification.push({
                id: 'IO-1',
                notificationMethod: 'IO',
                notificationRecurrence: 'beginning',
                outputIOPortID: '1'
            });
        }

        if (previousDefocusTriggerConfig === JSON.stringify(defocusTriggerConfig)) {
            return;
        }

        const res = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/Event/triggers/defocus-1'),
            {
                method: 'put',
                headers: {
                    'content-type': 'application/xml',
                },
                body: this.xmlBuilder.build(defocusTriggerConfig),
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

    public async setSceneChangeConfiguration(config: SceneChangeConfiguration) {
        const defocusRes = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/Smart/SceneChangeDetection/1'),
            {
                signal: this.timeoutSignal
            }
        );

        if (defocusRes.status !== 200) {
            throw new HttpRequestError();
        }

        const sceneChangeConfig = this.xmlParser.parse(await defocusRes.text());
        const previousSceneChangeConfig = JSON.stringify(sceneChangeConfig);

        sceneChangeConfig.SceneChangeDetection.enabled = config.enabled;
        sceneChangeConfig.SceneChangeDetection.sensitivityLevel = config.sensitivityLevel;

        if (previousSceneChangeConfig === JSON.stringify(sceneChangeConfig)) {
            return;
        }

        const res = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/Smart/SceneChangeDetection/1'),
            {
                method: 'put',
                headers: {
                    'content-type': 'application/xml',
                },
                body: this.xmlBuilder.build(sceneChangeConfig),
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

    public async setSceneChangeTriggerConfiguration(config: SceneChangeTriggerConfiguration) {
        const sceneChangeTriggerRes = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/Event/triggers/scenechangedetection-1'),
            {
                signal: this.timeoutSignal
            }
        );

        if (sceneChangeTriggerRes.status !== 200) {
            throw new HttpRequestError();
        }

        const sceneChangeTriggerConfig = this.xmlParser.parse(await sceneChangeTriggerRes.text());
        const previousSceneChangeTriggerConfig = JSON.stringify(sceneChangeTriggerConfig);

        if (!sceneChangeTriggerConfig.EventTrigger.EventTriggerNotificationList) {
            sceneChangeTriggerConfig.EventTrigger.EventTriggerNotificationList = {};
        }

        if (!sceneChangeTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification) {
            sceneChangeTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification = [];
        } else if (!Array.isArray(sceneChangeTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification)) {
            sceneChangeTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification = [sceneChangeTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification];
        }

        if (!config.email) {
            sceneChangeTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification = sceneChangeTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification.filter(
                (notification: Record<string, unknown>) => notification.notificationMethod !== 'email'
            );
        }

        if (!config.surveillanceCenter) {
            sceneChangeTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification = sceneChangeTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification.filter(
                (notification: Record<string, unknown>) => notification.notificationMethod !== 'center'
            );
        }

        if (config.surveillanceCenter) {
            sceneChangeTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification.push({
                id: 'center',
                notificationMethod: 'center',
                notificationRecurrence: 'beginning'
            });
        }

        if (config.email) {
            sceneChangeTriggerConfig.EventTrigger.EventTriggerNotificationList.EventTriggerNotification.push({
                id: 'email',
                notificationMethod: 'email',
                notificationRecurrence: 'beginning'
            });
        }

        if (previousSceneChangeTriggerConfig === JSON.stringify(sceneChangeTriggerConfig)) {
            return;
        }

        const res = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/Event/triggers/scenechangedetection-1'),
            {
                method: 'put',
                headers: {
                    'content-type': 'application/xml',
                },
                body: this.xmlBuilder.build(sceneChangeTriggerConfig),
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

    private async getCameraChannels() {
        const res = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/Streaming/channels'),
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
