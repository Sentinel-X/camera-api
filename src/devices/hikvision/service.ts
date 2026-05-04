import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import moment from 'moment-timezone';
import { BaseDevice } from '../base.js';
import { HttpRequestError, MissingConfigurationError } from '../../errors.js';
import { DeviceConfiguration, InvasionAreaCoordinate } from '../../types.js';
import { Capabilities, DefocusConfiguration, DefocusTriggerConfiguration, DeviceInformation, FieldDetectionConfiguration, FieldDetectionRegion, Hdd, ImageQualityConfiguration, ScheduleConfiguration, LineCrossingConfiguration, OverlayConfiguration, RecordingScheduleConfiguration, RegionEntranceConfiguration, RegionExitingConfiguration, SceneChangeConfiguration, SceneChangeTriggerConfiguration, SetStorageQuotaOptions, TimeConfiguration, FaceDetectionConfiguration, LPRConfiguration } from './types.js';
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

    public async getDeviceInformation(): Promise<DeviceInformation> {
        const res = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/System/deviceInfo'),
            {
                signal: this.timeoutSignal
            }
        );

        if (res.status !== 200) {
            throw new HttpRequestError();
        }

        const deviceInfo = await this.xmlParser.parse(await res.text());

        return {
            deviceName: deviceInfo?.DeviceInfo?.deviceName ?? '',
            model: deviceInfo?.DeviceInfo?.model ?? '',
            serialNumber: deviceInfo?.DeviceInfo?.serialNumber ?? '',
            firmwareVersion: deviceInfo?.DeviceInfo?.firmwareVersion ?? '',
        };
    }

    public async setFieldDetectionConfiguration(configuration: FieldDetectionConfiguration) {
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
        fieldDetectionConfig.FieldDetection.enabled = configuration.enabled;

        let fieldDetectionRegions = fieldDetectionConfig.FieldDetection.FieldDetectionRegionList?.FieldDetectionRegion ?? [];
        if (!Array.isArray(fieldDetectionRegions)) {
            fieldDetectionRegions = [fieldDetectionRegions];
        }

        for (const region of fieldDetectionRegions) {
            const newConfig = configuration.regions.find((config) => config.id === Number(region.id));
            if (!newConfig) {
                continue;
            }

            if (newConfig.detectionTarget) {
                region.detectionTarget = newConfig.detectionTarget.join(',');
            }

            if (typeof newConfig.sensitivityLevel === 'number') {
                region.sensitivityLevel = newConfig.sensitivityLevel;
            }

            if (typeof newConfig.timeThreshold === 'number') {
                region.timeThreshold = newConfig.timeThreshold;
            }

            if (typeof newConfig.confidenceLevel === 'string') {
                region.alarmConfidence = newConfig.confidenceLevel;
            }
        }

        fieldDetectionConfig.FieldDetection.FieldDetectionRegionList.FieldDetectionRegion = fieldDetectionRegions;

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

        if (configuration.schedule) {
            const schedule = {
                '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
                'Schedule': {
                    'id': 'fielddetection_video1',
                    'eventType': 'fielddetection',
                    'videoInputChannelID': 1,
                    'TimeBlockList': this.parseInvasionAreaScheduleToCamera(configuration.schedule),
                    '@_version': '2.0',
                    '@_xmlns': 'http://www.hikvision.com/ver20/XMLSchema'
                }
            };

            const res = await this.getDigestClient().fetch(
                this.buildURL('/ISAPI/Event/schedules/fieldDetections/fielddetection_video1'),
                {
                    method: 'put',
                    headers: {
                        'content-type': 'application/xml',
                    },
                    body: this.xmlBuilder.build(schedule),
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

    public async setLineCrossingConfiguration(configuration: LineCrossingConfiguration) {
        const lineCrossingDetectionRes = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/Smart/LineDetection/1'),
            {
                signal: this.timeoutSignal
            }
        );

        if (lineCrossingDetectionRes.status !== 200) {
            throw new HttpRequestError();
        }

        const lineCrossingDetectionConfig = this.xmlParser.parse(await lineCrossingDetectionRes.text());
        lineCrossingDetectionConfig.LineDetection.enabled = configuration.enabled;

        let lineCrossingRegions = lineCrossingDetectionConfig.LineDetection.LineItemList?.LineItem ?? [];
        if (!Array.isArray(lineCrossingRegions)) {
            lineCrossingRegions = [lineCrossingRegions];
        }

        for (const region of lineCrossingRegions) {
            const newConfig = configuration.regions.find((config) => config.id === Number(region.id));
            if (!newConfig) {
                continue;
            }

            if (newConfig.detectionTarget) {
                region.detectionTarget = newConfig.detectionTarget.join(',');
            }

            if (typeof newConfig.sensitivityLevel === 'number') {
                region.sensitivityLevel = newConfig.sensitivityLevel;
            }

            if (typeof newConfig.crossingDirection === 'string') {
                region.directionSensitivity = newConfig.crossingDirection;
            }

            if (typeof newConfig.confidenceLevel === 'string') {
                region.alarmConfidence = newConfig.confidenceLevel;
            }
        }

        lineCrossingDetectionConfig.LineDetection.LineItemList.LineItem = lineCrossingRegions;

        const res = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/Smart/LineDetection/1'),
            {
                method: 'put',
                headers: {
                    'content-type': 'application/xml',
                },
                body: this.xmlBuilder.build(lineCrossingDetectionConfig),
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

        if (configuration.schedule) {
            const schedule = {
                '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
                'Schedule': {
                    'id': 'linedetection_video1',
                    'eventType': 'linedetection',
                    'videoInputChannelID': 1,
                    'TimeBlockList': this.parseInvasionAreaScheduleToCamera(configuration.schedule),
                    '@_version': '2.0',
                    '@_xmlns': 'http://www.hikvision.com/ver20/XMLSchema'
                }
            };

            const res = await this.getDigestClient().fetch(
                this.buildURL('/ISAPI/Event/schedules/lineDetections/linedetection_video1'),
                {
                    method: 'put',
                    headers: {
                        'content-type': 'application/xml',
                    },
                    body: this.xmlBuilder.build(schedule),
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

    public async setRegionEntranceConfiguration(configuration: RegionEntranceConfiguration) {
        const regionEntranceRes = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/Smart/regionEntrance/1'),
            {
                signal: this.timeoutSignal
            }
        );

        if (regionEntranceRes.status !== 200) {
            throw new HttpRequestError();
        }

        const regionEntranceConfig = this.xmlParser.parse(await regionEntranceRes.text());
        regionEntranceConfig.RegionEntrance.enabled = configuration.enabled;

        let regionEntranceRegions = regionEntranceConfig.RegionEntrance.RegionEntranceRegionList?.RegionEntranceRegion ?? [];
        if (!Array.isArray(regionEntranceRegions)) {
            regionEntranceRegions = [regionEntranceRegions];
        }

        for (const region of regionEntranceRegions) {
            const newConfig = configuration.regions.find((config) => config.id === Number(region.id));
            if (!newConfig) {
                continue;
            }

            if (newConfig.detectionTarget) {
                region.detectionTarget = newConfig.detectionTarget.join(',');
            }

            if (typeof newConfig.sensitivityLevel === 'number') {
                region.sensitivityLevel = newConfig.sensitivityLevel;
            }

            if (typeof newConfig.confidenceLevel === 'string') {
                region.alarmConfidence = newConfig.confidenceLevel;
            }
        }

        regionEntranceConfig.RegionEntrance.RegionEntranceRegionList.RegionEntranceRegion = regionEntranceRegions;

        const res = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/Smart/regionEntrance/1'),
            {
                method: 'put',
                headers: {
                    'content-type': 'application/xml',
                },
                body: this.xmlBuilder.build(regionEntranceConfig),
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

        if (configuration.schedule) {
            const schedule = {
                '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
                'Schedule': {
                    'id': 'regionEntrance-1',
                    'eventType': 'regionEntrance',
                    'videoInputChannelID': 1,
                    'TimeBlockList': this.parseInvasionAreaScheduleToCamera(configuration.schedule),
                    '@_version': '2.0',
                    '@_xmlns': 'http://www.hikvision.com/ver20/XMLSchema'
                }
            };

            const res = await this.getDigestClient().fetch(
                this.buildURL('/ISAPI/Event/schedules/regionEntrances/regionEntrance-1'),
                {
                    method: 'put',
                    headers: {
                        'content-type': 'application/xml',
                    },
                    body: this.xmlBuilder.build(schedule),
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

    public async setRegionExitingConfiguration(configuration: RegionExitingConfiguration) {
        const regionExitingRes = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/Smart/regionExiting/1'),
            {
                signal: this.timeoutSignal
            }
        );

        if (regionExitingRes.status !== 200) {
            throw new HttpRequestError();
        }

        const regionExitingConfig = this.xmlParser.parse(await regionExitingRes.text());
        regionExitingConfig.RegionExiting.enabled = configuration.enabled;

        let regionExitingRegions = regionExitingConfig.RegionExiting.RegionExitingRegionList?.RegionExitingRegion ?? [];
        if (!Array.isArray(regionExitingRegions)) {
            regionExitingRegions = [regionExitingRegions];
        }

        for (const region of regionExitingRegions) {
            const newConfig = configuration.regions.find((config) => config.id === Number(region.id));
            if (!newConfig) {
                continue;
            }

            if (newConfig.detectionTarget) {
                region.detectionTarget = newConfig.detectionTarget.join(',');
            }

            if (typeof newConfig.sensitivityLevel === 'number') {
                region.sensitivityLevel = newConfig.sensitivityLevel;
            }

            if (typeof newConfig.confidenceLevel === 'string') {
                region.alarmConfidence = newConfig.confidenceLevel;
            }
        }

        regionExitingConfig.RegionExiting.RegionExitingRegionList.RegionExitingRegion = regionExitingRegions;

        const res = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/Smart/regionExiting/1'),
            {
                method: 'put',
                headers: {
                    'content-type': 'application/xml',
                },
                body: this.xmlBuilder.build(regionExitingConfig),
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

        if (configuration.schedule) {
            const schedule = {
                '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
                'Schedule': {
                    'id': 'regionExiting-1',
                    'eventType': 'regionExiting',
                    'videoInputChannelID': 1,
                    'TimeBlockList': this.parseInvasionAreaScheduleToCamera(configuration.schedule),
                    '@_version': '2.0',
                    '@_xmlns': 'http://www.hikvision.com/ver20/XMLSchema'
                }
            };

            const res = await this.getDigestClient().fetch(
                this.buildURL('/ISAPI/Event/schedules/regionExitings/regionExiting-1'),
                {
                    method: 'put',
                    headers: {
                        'content-type': 'application/xml',
                    },
                    body: this.xmlBuilder.build(schedule),
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

    public async setFaceDetectionConfiguration(configuration: FaceDetectionConfiguration) {
        const res = await this.getDigestClient().fetch(
            this.buildURL('ISAPI/Custom/OpenPlatform/App'),
            {
                signal: this.timeoutSignal
            }
        );

        if (res.status !== 200) {
            throw new HttpRequestError();
        }

        const customApps = this.xmlParser.parse(await res.text());
        if (!customApps?.AppList?.App) {
            throw new HttpRequestError();
        } else if (!Array.isArray(customApps.AppList.App)) {
            customApps.AppList.App = [customApps.AppList.App];
        }

        const facialApp = customApps?.AppList?.App?.find((app: { packageName: string; runStatus: boolean; }) => app?.packageName === 'Face Capture');
        if (!facialApp) {
            throw new MissingConfigurationError();
        }

        const isRunning = parseBoolean(facialApp.runStatus);

        if (configuration.enabled !== isRunning) {
            const updateResp = await this.getDigestClient().fetch(
                this.buildURL(`/ISAPI/Custom/OpenPlatform/App/${facialApp.id}/${configuration.enabled ? 'start' : 'stop'}`),
                {
                    method: 'put',
                    headers: {
                        'content-type': 'application/xml',
                    },
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

        // App disabled, no need to update remaining settings
        if (!configuration.enabled) {
            return;
        }

        const faceRuleRes = await this.getDigestClient().fetch(
            this.buildURL('/ISAPI/Intelligent/channels/1/faceRule'),
            {
                signal: this.timeoutSignal
            }
        );

        if (faceRuleRes.status !== 200) {
            throw new HttpRequestError();
        }

        // Enable face rule if not enabled
        const faceRuleConfig = this.xmlParser.parse(await faceRuleRes.text());
        if (!faceRuleConfig.FaceRule.enabled) {
            faceRuleConfig.FaceRule.enabled = true;

            const updateResp = await this.getDigestClient().fetch(
                this.buildURL('/ISAPI/Intelligent/channels/1/faceRule'),
                {
                    method: 'put',
                    body: this.xmlBuilder.build(faceRuleConfig),
                    headers: {
                        'content-type': 'application/xml',
                    },
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

        // Set alarm schedule
        if (configuration.schedule) {
            const updateScheduleResp = await this.getDigestClient().fetch(
                this.buildURL('/ISAPI/Event/schedules/faceSnap/faceSnap-1'),
                {
                    method: 'put',
                    body: this.xmlBuilder.build({
                        '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' }, 'Schedule': {
                            'id': 'faceSnap-1', 'eventType': 'faceSnap', 'videoInputChannelID': 1, 'TimeBlockList': {
                                'TimeBlock':
                                    [
                                        { 'dayOfWeek': 1, 'TimeRange': { 'beginTime': configuration.schedule.monday.start, 'endTime': configuration.schedule.monday.end } },
                                        { 'dayOfWeek': 2, 'TimeRange': { 'beginTime': configuration.schedule.tuesday.start, 'endTime': configuration.schedule.tuesday.end } },
                                        { 'dayOfWeek': 3, 'TimeRange': { 'beginTime': configuration.schedule.wednesday.start, 'endTime': configuration.schedule.wednesday.end } },
                                        { 'dayOfWeek': 4, 'TimeRange': { 'beginTime': configuration.schedule.thursday.start, 'endTime': configuration.schedule.thursday.end } },
                                        { 'dayOfWeek': 5, 'TimeRange': { 'beginTime': configuration.schedule.friday.start, 'endTime': configuration.schedule.friday.end } },
                                        { 'dayOfWeek': 6, 'TimeRange': { 'beginTime': configuration.schedule.saturday.start, 'endTime': configuration.schedule.saturday.end } },
                                        { 'dayOfWeek': 7, 'TimeRange': { 'beginTime': configuration.schedule.sunday.start, 'endTime': configuration.schedule.sunday.end } }
                                    ]
                            }
                        }
                    }),
                    headers: {
                        'content-type': 'application/xml',
                    },
                    signal: this.timeoutSignal
                }
            );

            if (updateScheduleResp.status !== 200) {
                throw new HttpRequestError();
            }

            const updateScheduleRes = this.xmlParser.parse(await updateScheduleResp.text());
            if (Number(updateScheduleRes?.ResponseStatus?.statusCode) !== 1 || updateScheduleRes?.ResponseStatus?.subStatusCode !== 'ok') {
                throw new HttpRequestError();
            }
        }

        // Update overlay capture settings
        if (configuration.pictureConfiguration) {
            const updateOverlayCaptureResp = await this.getDigestClient().fetch(
                this.buildURL('/ISAPI/Intelligent/channels/1/faceSnap/overlapPic?format=json'),
                {
                    method: 'put',
                    body: JSON.stringify({
                        'OverlapPic': {
                            'AddIntelInfo': {
                                'streamWithIntelInfo': configuration.pictureConfiguration.overlay.displayVCAOnStream,
                                'alarmWithTargetInfo': configuration.pictureConfiguration.overlay.displayTargetOnAlarm
                            },
                            'TargetPicParam': {
                                'targetPicMode': configuration.pictureConfiguration.pictureSettings.mode,
                                'targetPicWidth': configuration.pictureConfiguration.pictureSettings.faceDimensions.width,
                                'headHeight': configuration.pictureConfiguration.pictureSettings.faceDimensions.height,
                                'bodyHeight': configuration.pictureConfiguration.pictureSettings.faceDimensions.bodyHeight,
                                'TargetPicHeight': {
                                    'enable': configuration.pictureConfiguration.pictureSettings.fixedPictureHeight.enabled,
                                    'height': configuration.pictureConfiguration.pictureSettings.fixedPictureHeight.height
                                },
                                'FaceBeautification': {
                                    'enable': configuration.pictureConfiguration.pictureSettings.faceBeautification.enabled,
                                    'level': configuration.pictureConfiguration.pictureSettings.faceBeautification.level
                                }
                            },
                            'AlarmPicParam': {
                                'backgroundPicUpload': configuration.pictureConfiguration.pictureUpload.uploadBackground,
                                'picQuality': configuration.pictureConfiguration.pictureUpload.quality,
                                'PicSize': {
                                    'width': configuration.pictureConfiguration.pictureUpload.resolution.width,
                                    'height': configuration.pictureConfiguration.pictureUpload.resolution.height
                                },
                                'facePictureUpload': configuration.pictureConfiguration.pictureUpload.uploadFacePicture
                            },
                            'AlarmOsdParam': configuration.pictureConfiguration.pictureSettings.textOverlays.map(overlay => {
                                return {
                                    'enabled': overlay.enabled,
                                    'osdIndex': overlay.index,
                                    'osdValue': overlay.value,
                                };
                            }),
                        }
                    }),
                    headers: {
                        'content-type': 'application/json',
                    },
                    signal: this.timeoutSignal
                }
            );

            if (updateOverlayCaptureResp.status !== 200) {
                throw new HttpRequestError();
            }

            const updateOverlayCaptureRes = await updateOverlayCaptureResp.json();
            if (Number(updateOverlayCaptureRes?.statusCode) !== 1 || updateOverlayCaptureRes?.subStatusCode !== 'ok') {
                throw new HttpRequestError();
            }
        }

        // Configure webhooks
        if (configuration.webhookNotification && configuration.webhookNotification.length > 0) {
            for (const webhook of configuration.webhookNotification) {
                const updateEndpointsResp = await this.getDigestClient().fetch(
                    this.buildURL('/ISAPI/Event/notification/httpHosts'),
                    {
                        method: 'put',
                        body: this.xmlBuilder.build({
                            '?xml': { '@_encoding': 'UTF-8' },
                            HttpHostNotificationList: {
                                HttpHostNotification: {
                                    id: webhook.id,
                                    protocolType: webhook.protocol.toUpperCase(),
                                    hostName: webhook.host,
                                    url: webhook.path,
                                    portNo: webhook.port,
                                    parameterFormatType: 'XML',
                                    addressingFormatType: 'hostname',
                                    httpBroken: false,
                                    httpAuthenticationMethod: 'none'
                                }
                            }
                        }),
                        headers: {
                            'content-type': 'application/xml',
                        },
                        signal: this.timeoutSignal
                    }
                );

                if (updateEndpointsResp.status !== 200) {
                    throw new HttpRequestError();
                }

                const updateEndpointsRes = this.xmlParser.parse(await updateEndpointsResp.text());
                if (Number(updateEndpointsRes?.ResponseStatus?.statusCode) !== 1 || updateEndpointsRes?.ResponseStatus?.subStatusCode !== 'ok') {
                    throw new HttpRequestError();
                }
            }
        }
    }

    public async setLPRConfiguration(configuration: LPRConfiguration) {
        if (configuration.uploadData) {
            const res = await this.getDigestClient().fetch(
                this.buildURL('/ISAPI/ITC/TriggerMode/TPS'),
                {
                    signal: this.timeoutSignal
                }
            );

            if (res.status !== 200) {
                throw new HttpRequestError();
            }

            const applicationModeConfig = this.xmlParser.parse(await res.text());
            if (applicationModeConfig.TPS.enRealtimeDataUpload !== configuration.uploadData.uploadRealTimeData
                || applicationModeConfig.TPS.enStatisticalDataUpload !== configuration.uploadData.uploadStatisticsData
                || applicationModeConfig.TPS.posEnable !== configuration.uploadData.uploadPositionData
            ) {
                applicationModeConfig.TPS.enRealtimeDataUpload = configuration.uploadData.uploadRealTimeData;
                applicationModeConfig.TPS.enStatisticalDataUpload = configuration.uploadData.uploadStatisticsData;
                applicationModeConfig.TPS.posEnable = configuration.uploadData.uploadPositionData;

                const updateRes = await this.getDigestClient().fetch(
                    this.buildURL('/ISAPI/ITC/TriggerMode/TPS'),
                    {
                        method: 'put',
                        headers: {
                            'content-type': 'application/xml',
                        },
                        body: this.xmlBuilder.build(applicationModeConfig),
                        signal: this.timeoutSignal
                    }
                );

                if (updateRes.status !== 200) {
                    throw new HttpRequestError();
                }

                const updateResp = this.xmlParser.parse(await updateRes.text());
                if (Number(updateResp?.ResponseStatus?.statusCode) !== 1 || updateResp?.ResponseStatus?.subStatusCode !== 'ok') {
                    throw new HttpRequestError();
                }
            }
        }

        if (configuration.captureSettings) {
            const captureParamsRes = await this.getDigestClient().fetch(
                this.buildURL('/ISAPI/ITC/plateRecognitionParam'),
                {
                    signal: this.timeoutSignal
                }
            );

            if (captureParamsRes.status !== 200) {
                throw new HttpRequestError();
            }

            const captureParamsResConfig = this.xmlParser.parse(await captureParamsRes.text());
            if (String(captureParamsResConfig.PlateRecognitionParam.countryIndex) != String(configuration.captureSettings.countryIndex)) {
                captureParamsResConfig.PlateRecognitionParam.countryIndex = String(configuration.captureSettings.countryIndex);

                const updateRes = await this.getDigestClient().fetch(
                    this.buildURL('/ISAPI/ITC/plateRecognitionParam'),
                    {
                        method: 'put',
                        headers: {
                            'content-type': 'application/xml',
                        },
                        body: this.xmlBuilder.build(captureParamsResConfig),
                        signal: this.timeoutSignal
                    }
                );

                if (updateRes.status !== 200) {
                    throw new HttpRequestError();
                }

                const updateResp = this.xmlParser.parse(await updateRes.text());
                if (Number(updateResp?.ResponseStatus?.statusCode) !== 1 || updateResp?.ResponseStatus?.subStatusCode !== 'ok') {
                    throw new HttpRequestError();
                }
            }
        }

        if (configuration.vehicleDetectionFeatures) {
            const vehicleFeatureRes = await this.getDigestClient().fetch(
                this.buildURL('/ISAPI/ITC/carFeatureParam'),
                {
                    signal: this.timeoutSignal
                }
            );

            if (vehicleFeatureRes.status !== 200) {
                throw new HttpRequestError();
            }

            const vehicleFeatureConfig = this.xmlParser.parse(await vehicleFeatureRes.text());
            if (vehicleFeatureConfig.CarFeatureParam.safetyBeltEnabled !== configuration.vehicleDetectionFeatures.safetyBeltDetection
                || vehicleFeatureConfig.CarFeatureParam.callEnabled !== configuration.vehicleDetectionFeatures.phoneCallDetection
                || vehicleFeatureConfig.CarFeatureParam.helmetEnabled !== configuration.vehicleDetectionFeatures.helmetDetection
            ) {
                vehicleFeatureConfig.CarFeatureParam.safetyBeltEnabled = configuration.vehicleDetectionFeatures.safetyBeltDetection;
                vehicleFeatureConfig.CarFeatureParam.callEnabled = configuration.vehicleDetectionFeatures.phoneCallDetection;
                vehicleFeatureConfig.CarFeatureParam.helmetEnabled = configuration.vehicleDetectionFeatures.helmetDetection;

                const updateRes = await this.getDigestClient().fetch(
                    this.buildURL('/ISAPI/ITC/carFeatureParam'),
                    {
                        method: 'put',
                        headers: {
                            'content-type': 'application/xml',
                        },
                        body: this.xmlBuilder.build(vehicleFeatureConfig),
                        signal: this.timeoutSignal
                    }
                );

                if (updateRes.status !== 200) {
                    throw new HttpRequestError();
                }

                const updateResp = this.xmlParser.parse(await updateRes.text());
                if (Number(updateResp?.ResponseStatus?.statusCode) !== 1 || updateResp?.ResponseStatus?.subStatusCode !== 'ok') {
                    throw new HttpRequestError();
                }
            }
        }

        if (configuration.imageQualitySettings) {
            const encodeRes = await this.getDigestClient().fetch(
                this.buildURL('/ISAPI/ITC/Snapshot/channels/1/capResInfo'),
                {
                    signal: this.timeoutSignal
                }
            );

            if (encodeRes.status !== 200) {
                throw new HttpRequestError();
            }

            const encodeConfig = this.xmlParser.parse(await encodeRes.text());
            if (encodeConfig.CapResolution.capResolutionWidth !== configuration.imageQualitySettings.resolution.width
                || encodeConfig.CapResolution.capResolutionHeight !== configuration.imageQualitySettings.resolution.height
            ) {
                encodeConfig.CapResolution.capResolutionWidth = configuration.imageQualitySettings.resolution.width;
                encodeConfig.CapResolution.capResolutionHeight = configuration.imageQualitySettings.resolution.height;

                const updateRes = await this.getDigestClient().fetch(
                    this.buildURL('/ISAPI/ITC/Snapshot/channels/1/capResInfo'),
                    {
                        method: 'put',
                        headers: {
                            'content-type': 'application/xml',
                        },
                        body: this.xmlBuilder.build(encodeConfig),
                        signal: this.timeoutSignal
                    }
                );

                if (updateRes.status !== 200) {
                    throw new HttpRequestError();
                }

                const updateResp = this.xmlParser.parse(await updateRes.text());
                if (Number(updateResp?.ResponseStatus?.statusCode) !== 1 || updateResp?.ResponseStatus?.subStatusCode !== 'ok') {
                    throw new HttpRequestError();
                }
            }
        }

        if (configuration.schedules && configuration.schedules.length > 0) {
            const recordingScheduleRes = await this.getDigestClient().fetch(
                this.buildURL('/ISAPI/ITC/illegalSchedules?format=json'),
                {
                    signal: this.timeoutSignal
                }
            );

            if (recordingScheduleRes.status !== 200) {
                throw new HttpRequestError();
            }

            const recordingScheduleConfig = await recordingScheduleRes.json();

            for (const newSchedule of configuration.schedules) {
                const existingSchedule = recordingScheduleConfig?.IllegalScheduleList?.find((schedule: { Schedule: { eventType: string; }; }) => schedule.Schedule.eventType === newSchedule.eventType);
                if (!existingSchedule) {
                    throw new MissingConfigurationError();
                }

                existingSchedule.Schedule.TimeBlockList = [
                    {
                        TimeBlock: {
                            dayOfWeek: 1,
                            TimeRangeList: [{ TimeRange: { beginTime: newSchedule.schedule.monday.start, endTime: newSchedule.schedule.monday.end } }]
                        },
                    }, {
                        TimeBlock: {
                            dayOfWeek: 2,
                            TimeRangeList: [{ TimeRange: { beginTime: newSchedule.schedule.tuesday.start, endTime: newSchedule.schedule.tuesday.end } }]
                        },
                    }, {
                        TimeBlock: {
                            dayOfWeek: 3,
                            TimeRangeList: [{ TimeRange: { beginTime: newSchedule.schedule.wednesday.start, endTime: newSchedule.schedule.wednesday.end } }]
                        },
                    }, {
                        TimeBlock: {
                            dayOfWeek: 4,
                            TimeRangeList: [{ TimeRange: { beginTime: newSchedule.schedule.thursday.start, endTime: newSchedule.schedule.thursday.end } }]
                        },
                    }, {
                        TimeBlock: {
                            dayOfWeek: 5,
                            TimeRangeList: [{ TimeRange: { beginTime: newSchedule.schedule.friday.start, endTime: newSchedule.schedule.friday.end } }]
                        },
                    }, {
                        TimeBlock: {
                            dayOfWeek: 6,
                            TimeRangeList: [{ TimeRange: { beginTime: newSchedule.schedule.saturday.start, endTime: newSchedule.schedule.saturday.end } }]
                        },
                    }, {
                        TimeBlock: {
                            dayOfWeek: 7,
                            TimeRangeList: [{ TimeRange: { beginTime: newSchedule.schedule.sunday.start, endTime: newSchedule.schedule.sunday.end } }]
                        },
                    },
                ];
            }

            const updateRes = await this.getDigestClient().fetch(
                this.buildURL('/ISAPI/ITC/illegalSchedules?format=json'),
                {
                    method: 'put',
                    headers: {
                        'content-type': 'application/json',
                    },
                    body: JSON.stringify(recordingScheduleConfig),
                    signal: this.timeoutSignal
                }
            );

            if (updateRes.status !== 200) {
                throw new HttpRequestError();
            }

            const updateResp = await updateRes.json();
            if (Number(updateResp.statusCode) !== 1 || updateResp.subStatusCode !== 'ok') {
                throw new HttpRequestError();
            }
        }

        if (configuration.webhookNotification && configuration.webhookNotification.length > 0) {
            for (const webhook of configuration.webhookNotification) {
                const updateRes = await this.getDigestClient().fetch(
                    this.buildURL('/ISAPI/Event/notification/httpHosts'),
                    {
                        method: 'put',
                        headers: {
                            'content-type': 'application/xml',
                        },
                        body: this.xmlBuilder.build({
                            '?xml': { '@_encoding': 'UTF-8' },
                            HttpHostNotificationList: {
                                HttpHostNotification: {
                                    id: webhook.id,
                                    enabled: true,
                                    protocolType: webhook.protocol.toUpperCase(),
                                    hostName: webhook.host,
                                    url: webhook.path,
                                    portNo: webhook.port,
                                    parameterFormatType: 'XML',
                                    addressingFormatType: 'hostname',
                                    httpBroken: false,
                                    httpAuthenticationMethod: 'none',
                                    ANPR: { detectionUpLoadPicturesType: 'all' },
                                    SubscribeEvent: { heartbeat: 0, eventMode: 'all' },
                                }
                            }
                        }),
                        signal: this.timeoutSignal
                    }
                );

                if (updateRes.status !== 200) {
                    throw new HttpRequestError();
                }

                const updateResp = this.xmlParser.parse(await updateRes.text());
                if (Number(updateResp?.ResponseStatus?.statusCode) !== 1 || updateResp?.ResponseStatus?.subStatusCode !== 'ok') {
                    throw new HttpRequestError();
                }
            }
        }

        if (configuration.imageUploadOptions) {
            const binaryImageUploadRes = await this.getDigestClient().fetch(
                this.buildURL('/ISAPI/Intelligent/channels/1/mixedTargetDetection?format=json'),
                {
                    signal: this.timeoutSignal
                }
            );

            if (binaryImageUploadRes.status !== 200) {
                throw new HttpRequestError();
            }

            const binaryImageUploadConfig = await binaryImageUploadRes.json();
            if (binaryImageUploadConfig.MixedTargetDetection.isSupportBinaryPicUp !== configuration.imageUploadOptions.uploadBinaryImage
                || binaryImageUploadConfig.MixedTargetDetection.convertBinToBmpEnabled !== configuration.imageUploadOptions.convertBinaryToBitmap
            ) {
                binaryImageUploadConfig.MixedTargetDetection.isSupportBinaryPicUp = String(configuration.imageUploadOptions.uploadBinaryImage);
                binaryImageUploadConfig.MixedTargetDetection.convertBinToBmpEnabled = configuration.imageUploadOptions.convertBinaryToBitmap;

                const updateRes = await this.getDigestClient().fetch(
                    this.buildURL('/ISAPI/Intelligent/channels/1/mixedTargetDetection?format=json'),
                    {
                        method: 'put',
                        headers: {
                            'content-type': 'application/json',
                        },
                        body: JSON.stringify(binaryImageUploadConfig),
                        signal: this.timeoutSignal
                    }
                );

                if (updateRes.status !== 200) {
                    throw new HttpRequestError();
                }

                const updateResp = await updateRes.json();
                if (Number(updateResp.statusCode) !== 1 || updateResp.subStatusCode !== 'ok') {
                    throw new HttpRequestError();
                }
            }
        }
    }

    private parseInvasionAreaScheduleToCamera(schedule: ScheduleConfiguration) {
        return {
            'TimeBlock': [
                {
                    'dayOfWeek': 1,
                    'TimeRange': { 'beginTime': schedule.monday.start, 'endTime': schedule.monday.end }
                },
                {
                    'dayOfWeek': 2,
                    'TimeRange': { 'beginTime': schedule.tuesday.start, 'endTime': schedule.tuesday.end }
                },
                {
                    'dayOfWeek': 3,
                    'TimeRange': { 'beginTime': schedule.wednesday.start, 'endTime': schedule.wednesday.end }
                },
                {
                    'dayOfWeek': 4,
                    'TimeRange': { 'beginTime': schedule.thursday.start, 'endTime': schedule.thursday.end }
                },
                {
                    'dayOfWeek': 5,
                    'TimeRange': { 'beginTime': schedule.friday.start, 'endTime': schedule.friday.end }
                },
                {
                    'dayOfWeek': 6,
                    'TimeRange': { 'beginTime': schedule.saturday.start, 'endTime': schedule.saturday.end }
                },
                {
                    'dayOfWeek': 7,
                    'TimeRange': { 'beginTime': schedule.sunday.start, 'endTime': schedule.sunday.end }
                },
            ],
            '@_size': '8'
        };
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
