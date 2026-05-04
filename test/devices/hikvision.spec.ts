import { expect } from 'chai';
import { after, afterEach, before, describe, it } from 'mocha';
import nock from 'nock';
import { HikvisionDevice } from '../../src/devices/hikvision/service.js';
import { HttpRequestError, MissingConfigurationError } from '../../src/errors.js';
import { DeviceConfiguration } from '../../src/types.js';

const defaultConfig: DeviceConfiguration = {
    ipOrHttpAddress: 'http://hikvision.test',
    port: 80,
    username: 'admin',
    password: 'password'
};

describe('HikvisionDevice', () => {
    before(() => {
        nock.disableNetConnect();
    });

    after(() => {
        nock.enableNetConnect();
    });

    afterEach(() => {
        expect(nock.isDone()).to.equal(true);
        nock.cleanAll();
    });

    it('returns normalized coordinates from field detection XML', async () => {
        const payload = `<?xml version="1.0" encoding="UTF-8"?>
      <FieldDetection>
        <enabled>true</enabled>
        <normalizedScreenSize>
          <normalizedScreenWidth>1000</normalizedScreenWidth>
          <normalizedScreenHeight>1000</normalizedScreenHeight>
        </normalizedScreenSize>
        <FieldDetectionRegionList>
          <FieldDetectionRegion>
            <id>1</id>
            <RegionCoordinatesList>
              <RegionCoordinates><positionX>0</positionX><positionY>1000</positionY></RegionCoordinates>
              <RegionCoordinates><positionX>1000</positionX><positionY>0</positionY></RegionCoordinates>
            </RegionCoordinatesList>
          </FieldDetectionRegion>
        </FieldDetectionRegionList>
      </FieldDetection>`;

        nock('http://hikvision.test:80')
            .get('/ISAPI/Smart/FieldDetection/1')
            .reply(200, payload);

        const device = new HikvisionDevice(defaultConfig);

        const coordinates = await device.getInvasionAreaCoordinates();

        expect(coordinates).to.deep.equal([
            { x: 0, y: 0 },
            { x: 1, y: 1 }
        ]);
    });

    it('throws MissingConfigurationError when field detection is disabled', async () => {
        const payload = `<?xml version="1.0" encoding="UTF-8"?>
      <FieldDetection>
        <enabled>false</enabled>
      </FieldDetection>`;

        nock('http://hikvision.test:80')
            .get('/ISAPI/Smart/FieldDetection/1')
            .reply(200, payload);

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.getInvasionAreaCoordinates();
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(MissingConfigurationError);
        }
    });

    it('updates region id=1 coordinates using converted camera values', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <FieldDetection>
        <enabled>true</enabled>
        <normalizedScreenSize>
          <normalizedScreenWidth>1000</normalizedScreenWidth>
          <normalizedScreenHeight>1000</normalizedScreenHeight>
        </normalizedScreenSize>
        <FieldDetectionRegionList>
          <FieldDetectionRegion>
            <id>1</id>
            <RegionCoordinatesList>
              <RegionCoordinates><positionX>10</positionX><positionY>10</positionY></RegionCoordinates>
            </RegionCoordinatesList>
          </FieldDetectionRegion>
          <FieldDetectionRegion>
            <id>2</id>
          </FieldDetectionRegion>
        </FieldDetectionRegionList>
      </FieldDetection>`;

        const putPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <ResponseStatus>
        <statusCode>1</statusCode>
        <subStatusCode>ok</subStatusCode>
      </ResponseStatus>`;

        let putBody = '';
        nock('http://hikvision.test:80')
            .get('/ISAPI/Smart/FieldDetection/1')
            .reply(200, getPayload);

        nock('http://hikvision.test:80')
            .put('/ISAPI/Smart/FieldDetection/1', (body: string) => {
                putBody = String(body);
                return true;
            })
            .reply(200, putPayload);

        const device = new HikvisionDevice(defaultConfig);

        await device.setInvasionAreaCoordinates([
            { x: 0.25, y: 0.75 },
            { x: 1, y: 0 }
        ]);

        expect(putBody).to.include('<positionX>250</positionX>');
        expect(putBody).to.include('<positionY>250</positionY>');
        expect(putBody).to.include('<positionX>1000</positionX>');
        expect(putBody).to.include('<positionY>1000</positionY>');
    });

    it('throws HttpRequestError when update response is not ok', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <FieldDetection>
        <enabled>true</enabled>
        <normalizedScreenSize>
          <normalizedScreenWidth>1000</normalizedScreenWidth>
          <normalizedScreenHeight>1000</normalizedScreenHeight>
        </normalizedScreenSize>
        <FieldDetectionRegionList>
          <FieldDetectionRegion><id>1</id></FieldDetectionRegion>
          <FieldDetectionRegion><id>2</id></FieldDetectionRegion>
        </FieldDetectionRegionList>
      </FieldDetection>`;

        const badPutPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <ResponseStatus>
        <statusCode>2</statusCode>
        <subStatusCode>error</subStatusCode>
      </ResponseStatus>`;

        nock('http://hikvision.test:80')
            .get('/ISAPI/Smart/FieldDetection/1')
            .reply(200, getPayload);

        nock('http://hikvision.test:80')
            .put('/ISAPI/Smart/FieldDetection/1')
            .reply(200, badPutPayload);

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.setInvasionAreaCoordinates([{ x: 0.1, y: 0.2 }]);
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('updates image quality configuration and returns needsReboot when camera requires reboot', async () => {
        const channelsPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <StreamingChannelList>
        <StreamingChannel>
          <id>101</id>
        </StreamingChannel>
        <StreamingChannel>
          <id>102</id>
        </StreamingChannel>
      </StreamingChannelList>`;

        const channelPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <StreamingChannel>
        <id>101</id>
        <channelName>old-name</channelName>
        <Video>
          <videoCodecType>H.264</videoCodecType>
          <maxFrameRate>1500</maxFrameRate>
          <videoResolutionWidth>1280</videoResolutionWidth>
          <videoResolutionHeight>720</videoResolutionHeight>
          <constantBitRate>1024</constantBitRate>
          <vbrUpperCap>1200</vbrUpperCap>
          <vbrAverageCap>800</vbrAverageCap>
          <SmartCodec>
            <enabled>false</enabled>
          </SmartCodec>
          <H264Profile>Main</H264Profile>
        </Video>
      </StreamingChannel>`;

        const rebootRequiredPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <ResponseStatus>
        <statusCode>7</statusCode>
        <subStatusCode>rebootRequired</subStatusCode>
      </ResponseStatus>`;

        let putBody = '';

        nock('http://hikvision.test:80')
            .get('/ISAPI/Streaming/channels')
            .reply(200, channelsPayload);

        nock('http://hikvision.test:80')
            .get('/ISAPI/Streaming/channels/101')
            .reply(200, channelPayload);

        nock('http://hikvision.test:80')
            .put('/ISAPI/Streaming/channels/101', (body: string) => {
                putBody = String(body);
                return true;
            })
            .reply(200, rebootRequiredPayload);

        const device = new HikvisionDevice({
            ...defaultConfig,
            serialNumber: 'SERIAL-123'
        });

        const result = await device.setImageQualityConfiguration({
            compression: 'h265',
            fps: 20,
            resolution: {
                width: 1920,
                height: 1080
            },
            bitrate: {
                constant: 2048,
                variableCap: 2200,
                variableAverage: 1100
            }
        });

        expect(result).to.deep.equal({ needsReboot: true });
        expect(putBody).to.include('<channelName>SERIAL-123</channelName>');
        expect(putBody).to.include('<videoCodecType>H.265</videoCodecType>');
        expect(putBody).to.include('<H265Profile>Main</H265Profile>');
        expect(putBody).to.not.include('<H264Profile>');
        expect(putBody).to.include('<maxFrameRate>2000</maxFrameRate>');
        expect(putBody).to.include('<videoResolutionWidth>1920</videoResolutionWidth>');
        expect(putBody).to.include('<videoResolutionHeight>1080</videoResolutionHeight>');
        expect(putBody).to.include('<constantBitRate>2048</constantBitRate>');
        expect(putBody).to.include('<vbrUpperCap>2200</vbrUpperCap>');
        expect(putBody).to.include('<vbrAverageCap>1100</vbrAverageCap>');
    });

    it('returns needsReboot=false when no channel update is required', async () => {
        const channelsPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <StreamingChannelList>
        <StreamingChannel>
          <id>101</id>
        </StreamingChannel>
      </StreamingChannelList>`;

        const channelPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <StreamingChannel>
        <id>101</id>
        <channelName>camera-1</channelName>
        <Video>
          <videoCodecType>H.265</videoCodecType>
          <maxFrameRate>2000</maxFrameRate>
          <videoResolutionWidth>1920</videoResolutionWidth>
          <videoResolutionHeight>1080</videoResolutionHeight>
          <constantBitRate>2048</constantBitRate>
          <vbrUpperCap>2200</vbrUpperCap>
          <vbrAverageCap>1100</vbrAverageCap>
        </Video>
      </StreamingChannel>`;

        nock('http://hikvision.test:80')
            .get('/ISAPI/Streaming/channels')
            .reply(200, channelsPayload);

        nock('http://hikvision.test:80')
            .get('/ISAPI/Streaming/channels/101')
            .reply(200, channelPayload);

        const device = new HikvisionDevice(defaultConfig);

        const result = await device.setImageQualityConfiguration({
            compression: 'h265',
            fps: 20,
            resolution: {
                width: 1920,
                height: 1080
            },
            bitrate: {
                constant: 2048,
                variableCap: 2200,
                variableAverage: 1100
            }
        });

        expect(result).to.deep.equal({ needsReboot: false });
    });

    it('skips smart codec update when enabled value is already set to requested value', async () => {
        const channelsPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <StreamingChannelList>
        <StreamingChannel>
          <id>101</id>
        </StreamingChannel>
      </StreamingChannelList>`;

        const channelPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <StreamingChannel>
        <id>101</id>
        <channelName>camera-1</channelName>
        <Video>
          <videoCodecType>H.265</videoCodecType>
          <maxFrameRate>2000</maxFrameRate>
          <videoResolutionWidth>1920</videoResolutionWidth>
          <videoResolutionHeight>1080</videoResolutionHeight>
          <constantBitRate>2048</constantBitRate>
          <vbrUpperCap>2200</vbrUpperCap>
          <vbrAverageCap>1100</vbrAverageCap>
          <SmartCodec>
            <enabled>true</enabled>
          </SmartCodec>
        </Video>
      </StreamingChannel>`;

        nock('http://hikvision.test:80')
            .get('/ISAPI/Streaming/channels')
            .reply(200, channelsPayload);

        nock('http://hikvision.test:80')
            .get('/ISAPI/Streaming/channels/101')
            .reply(200, channelPayload);

        const device = new HikvisionDevice(defaultConfig);

        // smartCodec is already true, so no PUT should be sent
        const result = await device.setImageQualityConfiguration({
            smartCodec: true
        });

        expect(result).to.deep.equal({ needsReboot: false });
    });

    it('sends smart codec update when enabled value differs from requested value', async () => {
        const channelsPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <StreamingChannelList>
        <StreamingChannel>
          <id>101</id>
        </StreamingChannel>
      </StreamingChannelList>`;

        const channelPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <StreamingChannel>
        <id>101</id>
        <channelName>camera-1</channelName>
        <Video>
          <videoCodecType>H.265</videoCodecType>
          <maxFrameRate>2000</maxFrameRate>
          <videoResolutionWidth>1920</videoResolutionWidth>
          <videoResolutionHeight>1080</videoResolutionHeight>
          <SmartCodec>
            <enabled>false</enabled>
          </SmartCodec>
        </Video>
      </StreamingChannel>`;

        const successPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <ResponseStatus>
        <statusCode>1</statusCode>
        <subStatusCode>ok</subStatusCode>
      </ResponseStatus>`;

        let putBody = '';

        nock('http://hikvision.test:80')
            .get('/ISAPI/Streaming/channels')
            .reply(200, channelsPayload);

        nock('http://hikvision.test:80')
            .get('/ISAPI/Streaming/channels/101')
            .reply(200, channelPayload);

        nock('http://hikvision.test:80')
            .put('/ISAPI/Streaming/channels/101', (body: string) => {
                putBody = String(body);
                return true;
            })
            .reply(200, successPayload);

        const device = new HikvisionDevice(defaultConfig);

        // smartCodec is false but we request true, so a PUT should be sent
        const result = await device.setImageQualityConfiguration({
            smartCodec: true
        });

        expect(result).to.deep.equal({ needsReboot: false });
        expect(putBody).to.include('<enabled>true</enabled>');
    });

    it('throws HttpRequestError when channel update response is invalid', async () => {
        const channelsPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <StreamingChannelList>
        <StreamingChannel>
          <id>101</id>
        </StreamingChannel>
      </StreamingChannelList>`;

        const channelPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <StreamingChannel>
        <id>101</id>
        <channelName>camera-1</channelName>
        <Video>
          <videoCodecType>H.264</videoCodecType>
          <maxFrameRate>1500</maxFrameRate>
          <videoResolutionWidth>1280</videoResolutionWidth>
          <videoResolutionHeight>720</videoResolutionHeight>
          <constantBitRate>1024</constantBitRate>
          <vbrUpperCap>1200</vbrUpperCap>
          <vbrAverageCap>800</vbrAverageCap>
        </Video>
      </StreamingChannel>`;

        const invalidUpdatePayload = `<?xml version="1.0" encoding="UTF-8"?>
      <ResponseStatus>
        <statusCode>2</statusCode>
        <subStatusCode>error</subStatusCode>
      </ResponseStatus>`;

        nock('http://hikvision.test:80')
            .get('/ISAPI/Streaming/channels')
            .reply(200, channelsPayload);

        nock('http://hikvision.test:80')
            .get('/ISAPI/Streaming/channels/101')
            .reply(200, channelPayload);

        nock('http://hikvision.test:80')
            .put('/ISAPI/Streaming/channels/101')
            .reply(200, invalidUpdatePayload);

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.setImageQualityConfiguration({
                compression: 'h265',
                fps: 20
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('updates recording schedule configuration using day start/end and record flags', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <TrackList>
        <Track>
          <id>1</id>
          <Enable>false</Enable>
          <LoopEnable>true</LoopEnable>
          <CustomExtensionList>
            <CustomExtension>
              <enableSchedule>false</enableSchedule>
            </CustomExtension>
          </CustomExtensionList>
          <TrackSchedule>
            <ScheduleBlockList>
              <ScheduleBlock>
                <id>1</id>
              </ScheduleBlock>
            </ScheduleBlockList>
          </TrackSchedule>
        </Track>
      </TrackList>`;

        const putResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <ResponseStatus>
        <statusCode>1</statusCode>
        <subStatusCode>ok</subStatusCode>
      </ResponseStatus>`;

        let putBody = '';

        nock('http://hikvision.test:80')
            .get('/ISAPI/ContentMgmt/record/tracks')
            .reply(200, getPayload);

        nock('http://hikvision.test:80')
            .put('/ISAPI/ContentMgmt/record/tracks', (body: string) => {
                putBody = String(body);
                return true;
            })
            .reply(200, putResponse);

        const device = new HikvisionDevice(defaultConfig);

        await device.setRecordingScheduleConfiguration([
            {
                channelId: 1,
                enabled: true,
                overwriteOldestRecords: false,
                schedule: {
                    monday: { start: '01:00:00', end: '02:00:00', record: true },
                    tuesday: { start: '03:00:00', end: '04:00:00', record: false },
                    wednesday: { start: '05:00:00', end: '06:00:00', record: true },
                    thursday: { start: '07:00:00', end: '08:00:00', record: false },
                    friday: { start: '09:00:00', end: '10:00:00', record: true },
                    saturday: { start: '11:00:00', end: '12:00:00', record: false },
                    sunday: { start: '13:00:00', end: '23:59:59', record: true },
                }
            }
        ]);

        expect(putBody).to.include('<Enable>true</Enable>');
        expect(putBody).to.include('<LoopEnable>false</LoopEnable>');
        expect(putBody).to.include('<enableSchedule>true</enableSchedule>');

        expect(putBody).to.include('<DayOfWeek>Monday</DayOfWeek>');
        expect(putBody).to.include('<TimeOfDay>01:00:00</TimeOfDay>');
        expect(putBody).to.include('<TimeOfDay>02:00:00</TimeOfDay>');
        expect(putBody).to.include('<DayOfWeek>Tuesday</DayOfWeek>');
        expect(putBody).to.include('<TimeOfDay>03:00:00</TimeOfDay>');
        expect(putBody).to.include('<TimeOfDay>04:00:00</TimeOfDay>');
        expect(putBody).to.include('<DayOfWeek>Sunday</DayOfWeek>');
        expect(putBody).to.include('<TimeOfDay>13:00:00</TimeOfDay>');
        expect(putBody).to.include('<TimeOfDay>23:59:59</TimeOfDay>');
        expect((putBody.match(/<ScheduleAction>/g) || []).length).to.equal(7);

        expect(putBody).to.include('<Record>true</Record>');
        expect(putBody).to.include('<Record>false</Record>');
    });

    it('does not send schedule update when no configuration matches any track', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <TrackList>
        <Track>
          <id>1</id>
          <Enable>true</Enable>
          <LoopEnable>true</LoopEnable>
          <CustomExtensionList>
            <CustomExtension>
              <enableSchedule>true</enableSchedule>
            </CustomExtension>
          </CustomExtensionList>
          <TrackSchedule>
            <ScheduleBlockList>
              <ScheduleBlock>
                <id>1</id>
                <ScheduleAction>
                  <id>1</id>
                  <ScheduleActionStartTime><DayOfWeek>Monday</DayOfWeek><TimeOfDay>00:00:00</TimeOfDay></ScheduleActionStartTime>
                  <ScheduleActionEndTime><DayOfWeek>Monday</DayOfWeek><TimeOfDay>24:00:00</TimeOfDay></ScheduleActionEndTime>
                  <ScheduleDSTEnable>false</ScheduleDSTEnable>
                  <Actions><Record>true</Record><ActionRecordingMode>CMR</ActionRecordingMode></Actions>
                </ScheduleAction>
              </ScheduleBlock>
            </ScheduleBlockList>
          </TrackSchedule>
        </Track>
      </TrackList>`;

        nock('http://hikvision.test:80')
            .get('/ISAPI/ContentMgmt/record/tracks')
            .reply(200, getPayload);

        const device = new HikvisionDevice(defaultConfig);

        await device.setRecordingScheduleConfiguration([
            {
                channelId: 2,
                enabled: true,
                overwriteOldestRecords: false,
                schedule: {
                    monday: { start: '01:00:00', end: '02:00:00', record: true },
                    tuesday: { start: '01:00:00', end: '02:00:00', record: true },
                    wednesday: { start: '01:00:00', end: '02:00:00', record: true },
                    thursday: { start: '01:00:00', end: '02:00:00', record: true },
                    friday: { start: '01:00:00', end: '02:00:00', record: true },
                    saturday: { start: '01:00:00', end: '02:00:00', record: true },
                    sunday: { start: '01:00:00', end: '02:00:00', record: true },
                }
            }
        ]);
    });

    it('throws MissingConfigurationError when schedule block is missing', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <TrackList>
        <Track>
          <id>1</id>
          <Enable>true</Enable>
          <LoopEnable>true</LoopEnable>
          <CustomExtensionList>
            <CustomExtension>
              <enableSchedule>true</enableSchedule>
            </CustomExtension>
          </CustomExtensionList>
          <TrackSchedule></TrackSchedule>
        </Track>
      </TrackList>`;

        nock('http://hikvision.test:80')
            .get('/ISAPI/ContentMgmt/record/tracks')
            .reply(200, getPayload);

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.setRecordingScheduleConfiguration([
                {
                    channelId: 1,
                    enabled: true,
                    overwriteOldestRecords: false,
                    schedule: {
                        monday: { start: '01:00:00', end: '02:00:00', record: true },
                        tuesday: { start: '01:00:00', end: '02:00:00', record: true },
                        wednesday: { start: '01:00:00', end: '02:00:00', record: true },
                        thursday: { start: '01:00:00', end: '02:00:00', record: true },
                        friday: { start: '01:00:00', end: '02:00:00', record: true },
                        saturday: { start: '01:00:00', end: '02:00:00', record: true },
                        sunday: { start: '01:00:00', end: '02:00:00', record: true },
                    }
                }
            ]);
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(MissingConfigurationError);
        }
    });

    it('throws HttpRequestError when recording schedule update response is invalid', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <TrackList>
        <Track>
          <id>1</id>
          <Enable>false</Enable>
          <LoopEnable>false</LoopEnable>
          <CustomExtensionList>
            <CustomExtension>
              <enableSchedule>false</enableSchedule>
            </CustomExtension>
          </CustomExtensionList>
          <TrackSchedule>
            <ScheduleBlockList>
              <ScheduleBlock>
                <id>1</id>
              </ScheduleBlock>
            </ScheduleBlockList>
          </TrackSchedule>
        </Track>
      </TrackList>`;

        const invalidPutResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <ResponseStatus>
        <statusCode>2</statusCode>
        <subStatusCode>error</subStatusCode>
      </ResponseStatus>`;

        nock('http://hikvision.test:80')
            .get('/ISAPI/ContentMgmt/record/tracks')
            .reply(200, getPayload);

        nock('http://hikvision.test:80')
            .put('/ISAPI/ContentMgmt/record/tracks')
            .reply(200, invalidPutResponse);

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.setRecordingScheduleConfiguration([
                {
                    channelId: 1,
                    enabled: true,
                    overwriteOldestRecords: false,
                    schedule: {
                        monday: { start: '01:00:00', end: '02:00:00', record: true },
                        tuesday: { start: '01:00:00', end: '02:00:00', record: true },
                        wednesday: { start: '01:00:00', end: '02:00:00', record: true },
                        thursday: { start: '01:00:00', end: '02:00:00', record: true },
                        friday: { start: '01:00:00', end: '02:00:00', record: true },
                        saturday: { start: '01:00:00', end: '02:00:00', record: true },
                        sunday: { start: '01:00:00', end: '02:00:00', record: true },
                    }
                }
            ]);
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

      it('returns parsed HDD list from camera payload', async () => {
        const hddPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <hddList version="1.0" xmlns="http://www.hikvision.com/ver10/XMLSchema" size="1" >
        <hdd>
          <id>1</id>
          <hddName>hdde</hddName>
          <hddPath></hddPath>
          <hddType>SATA</hddType>
          <status>ok</status>
          <capacity>477103</capacity>
          <freeSpace>0</freeSpace>
          <property>RW</property>
          <formatType>EXT4</formatType>
          <Encryption>
          <passwordLen min="6" max="64"/>
          <encryptionStatus opt="unencrypted,encrypted,verfyFailed">unencrypted</encryptionStatus>
          <encryptFormatType opt="EXT4">EXT4</encryptFormatType>
          </Encryption>
          <installationTime>21-Apr-2026 15:59</installationTime>
        </hdd>
        </hddList>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/ContentMgmt/Storage/hdd')
          .reply(200, hddPayload);

        const device = new HikvisionDevice(defaultConfig);

        const hddList = await device.getHddList();

        expect(hddList).to.deep.equal([
          {
            id: 1,
            capacity: 477103,
            freeSpace: 0,
          }
        ]);
      });

      it('throws HttpRequestError when getHddList request fails', async () => {
        nock('http://hikvision.test:80')
          .get('/ISAPI/ContentMgmt/Storage/hdd')
          .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.getHddList();
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('updates storage quota when quota ratios differ', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <diskQuota version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
          <id>1</id>
          <type>ratio</type>
          <videoQuotaRatio>95</videoQuotaRatio>
          <totalVideoVolume>449536</totalVideoVolume>
          <freeVideoQuota>0</freeVideoQuota>
          <pictureQuotaRatio>5</pictureQuotaRatio>
          <totalPictureVolume>256</totalPictureVolume>
          <freePictureQuota>0</freePictureQuota>
        </diskQuota>`;

        const putResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        let putBody = '';

        nock('http://hikvision.test:80')
          .get('/ISAPI/ContentMgmt/Storage/quota/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/ContentMgmt/Storage/quota/1', (body: string) => {
            putBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        const device = new HikvisionDevice(defaultConfig);

        await device.setStorageQuota({
          hddId: 1,
          videoQuotaRatio: 90,
          pictureQuotaRatio: 10,
        });

        expect(putBody).to.include('<videoQuotaRatio>90</videoQuotaRatio>');
        expect(putBody).to.include('<pictureQuotaRatio>10</pictureQuotaRatio>');
      });

      it('does not send storage quota update when ratios are unchanged', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <diskQuota version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
          <id>1</id>
          <type>ratio</type>
          <videoQuotaRatio>95</videoQuotaRatio>
          <pictureQuotaRatio>5</pictureQuotaRatio>
        </diskQuota>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/ContentMgmt/Storage/quota/1')
          .reply(200, getPayload);

        const device = new HikvisionDevice(defaultConfig);

        await device.setStorageQuota({
          hddId: 1,
          videoQuotaRatio: 95,
          pictureQuotaRatio: 5,
        });
      });

      it('throws HttpRequestError when setStorageQuota get request fails', async () => {
        nock('http://hikvision.test:80')
          .get('/ISAPI/ContentMgmt/Storage/quota')
          .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setStorageQuota({
            videoQuotaRatio: 90,
            pictureQuotaRatio: 10,
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('throws HttpRequestError when setStorageQuota update request fails', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <diskQuota version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
          <id>1</id>
          <type>ratio</type>
          <videoQuotaRatio>95</videoQuotaRatio>
          <pictureQuotaRatio>5</pictureQuotaRatio>
        </diskQuota>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/ContentMgmt/Storage/quota/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/ContentMgmt/Storage/quota/1')
          .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setStorageQuota({
            hddId: 1,
            videoQuotaRatio: 80,
            pictureQuotaRatio: 20,
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('throws HttpRequestError when setStorageQuota update response is invalid', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <diskQuota version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
          <id>1</id>
          <type>ratio</type>
          <videoQuotaRatio>95</videoQuotaRatio>
          <pictureQuotaRatio>5</pictureQuotaRatio>
        </diskQuota>`;

        const invalidPutResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>2</statusCode>
          <subStatusCode>error</subStatusCode>
        </ResponseStatus>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/ContentMgmt/Storage/quota/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/ContentMgmt/Storage/quota/1')
          .reply(200, invalidPutResponse);

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setStorageQuota({
            hddId: 1,
            videoQuotaRatio: 80,
            pictureQuotaRatio: 20,
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

    it('updates time configuration in manual mode', async () => {
        let timeBody = '';

        nock('http://hikvision.test:80')
            .put('/ISAPI/System/time', (body: string) => {
                timeBody = String(body);
                return true;
            })
            .reply(200, '');

        const device = new HikvisionDevice(defaultConfig);

        await device.setTimeConfiguration({
            ntp: {
                enabled: false
            },
            timezone: 'GMT-03:00'
        });

        expect(timeBody).to.include('<timeMode>manual</timeMode>');
        expect(timeBody).to.include('<timeZone>GMT-03:00</timeZone>');
        expect(timeBody).to.match(/<localTime>.+<\/localTime>/);
    });

    it('updates time configuration in ntp mode', async () => {
        let timeBody = '';
        let ntpBody = '';

        nock('http://hikvision.test:80')
            .put('/ISAPI/System/time', (body: string) => {
                timeBody = String(body);
                return true;
            })
            .reply(200, '');

        nock('http://hikvision.test:80')
            .put('/ISAPI/System/time/ntpServers/1', (body: string) => {
                ntpBody = String(body);
                return true;
            })
            .reply(200, '');

        const device = new HikvisionDevice(defaultConfig);

        await device.setTimeConfiguration({
            ntp: {
                enabled: true,
                server: 'time.google.com',
                port: 123,
                interval: 60
            },
            timezone: 'GMT-03:00'
        });

        expect(timeBody).to.include('<timeMode>NTP</timeMode>');
        expect(timeBody).to.include('<timeZone>GMT-03:00</timeZone>');
        expect(timeBody).to.not.include('<localTime>');

        expect(ntpBody).to.include('<NTPServer>');
        expect(ntpBody).to.include('<id>1</id>');
        expect(ntpBody).to.include('<addressingFormatType>hostname</addressingFormatType>');
        expect(ntpBody).to.include('<hostName>time.google.com</hostName>');
        expect(ntpBody).to.include('<portNo>123</portNo>');
        expect(ntpBody).to.include('<synchronizeInterval>60</synchronizeInterval>');
    });

    it('throws HttpRequestError when time update request fails', async () => {
        nock('http://hikvision.test:80')
            .put('/ISAPI/System/time')
            .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.setTimeConfiguration({
                ntp: {
                    enabled: false
                },
                timezone: 'GMT-03:00'
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('throws HttpRequestError when ntp update request fails', async () => {
        nock('http://hikvision.test:80')
            .put('/ISAPI/System/time')
            .reply(200, '');

        nock('http://hikvision.test:80')
            .put('/ISAPI/System/time/ntpServers/1')
            .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.setTimeConfiguration({
                ntp: {
                    enabled: true,
                    server: 'time.google.com',
                    port: 123,
                    interval: 60
                },
                timezone: 'GMT-03:00'
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('returns current time from camera xml', async () => {
        const timePayload = `<?xml version="1.0" encoding="UTF-8"?>
        <Time>
        <timeMode>manual</timeMode>
        <localTime>2026-04-16T02:28:28-03:00</localTime>
        <timeZone>CST+3:00:00</timeZone>
        </Time>`;

        nock('http://hikvision.test:80')
            .get('/ISAPI/System/time')
            .reply(200, timePayload);

        const device = new HikvisionDevice(defaultConfig);

        const currentTime = await device.getCurrentTime();

        expect(currentTime.toISOString()).to.equal('2026-04-16T05:28:28.000Z');
    });

    it('throws HttpRequestError when getCurrentTime request fails', async () => {
        nock('http://hikvision.test:80')
            .get('/ISAPI/System/time')
            .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.getCurrentTime();
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('throws HttpRequestError when camera returns invalid current time', async () => {
        const timePayload = `<?xml version="1.0" encoding="UTF-8"?>
        <Time>
        <timeMode>manual</timeMode>
        <localTime>not-a-date</localTime>
        <timeZone>CST+3:00:00</timeZone>
        </Time>`;

        nock('http://hikvision.test:80')
            .get('/ISAPI/System/time')
            .reply(200, timePayload);

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.getCurrentTime();
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('sets current time preserving camera time configuration fields', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <Time>
        <timeMode>manual</timeMode>
        <localTime>2026-04-16T02:28:28-03:00</localTime>
        <timeZone>GMT-03:00</timeZone>
        </Time>`;

        let putBody = '';

        nock('http://hikvision.test:80')
            .get('/ISAPI/System/time')
            .reply(200, getPayload);

        nock('http://hikvision.test:80')
            .put('/ISAPI/System/time', (body: string) => {
                putBody = String(body);
                return true;
            })
            .reply(200, '');

        const device = new HikvisionDevice(defaultConfig);

        await device.setCurrentTime(new Date('2026-04-16T05:30:35.000Z'));

        expect(putBody).to.include('<timeMode>manual</timeMode>');
        expect(putBody).to.include('<timeZone>GMT-03:00</timeZone>');
        expect(putBody).to.match(/<localTime>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})<\/localTime>/);
        expect(putBody).to.not.include('<localTime>2026-04-16T02:28:28-03:00</localTime>');
    });

    it('throws HttpRequestError when setCurrentTime cannot read current configuration', async () => {
        nock('http://hikvision.test:80')
            .get('/ISAPI/System/time')
            .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.setCurrentTime(new Date('2026-04-16T05:30:35.000Z'));
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('throws HttpRequestError when setCurrentTime update request fails', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <Time>
        <timeMode>manual</timeMode>
        <localTime>2026-04-16T02:28:28-03:00</localTime>
        <timeZone>GMT-03:00</timeZone>
        </Time>`;

        nock('http://hikvision.test:80')
            .get('/ISAPI/System/time')
            .reply(200, getPayload);

        nock('http://hikvision.test:80')
            .put('/ISAPI/System/time')
            .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.setCurrentTime(new Date('2026-04-16T05:30:35.000Z'));
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

      it('returns overlay configuration from camera xml', async () => {
        const overlayPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <VideoOverlay>
          <normalizedScreenSize>
            <normalizedScreenWidth>704</normalizedScreenWidth>
            <normalizedScreenHeight>480</normalizedScreenHeight>
          </normalizedScreenSize>
          <TextOverlayList size="1">
            <TextOverlay>
              <id>1</id>
              <enabled>true</enabled>
              <positionX>0</positionX>
              <positionY>480</positionY>
              <displayText>SMART SAMPA</displayText>
            </TextOverlay>
          </TextOverlayList>
          <DateTimeOverlay>
            <enabled>true</enabled>
            <positionX>550</positionX>
            <positionY>480</positionY>
            <dateStyle>DD-MM-YYYY</dateStyle>
            <timeStyle>24hour</timeStyle>
            <displayWeek>false</displayWeek>
          </DateTimeOverlay>
          <channelNameOverlay>
            <enabled>false</enabled>
            <positionX>628</positionX>
            <positionY>64</positionY>
          </channelNameOverlay>
          <fontSize>32*32</fontSize>
          <alignment>customize</alignment>
        </VideoOverlay>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/System/Video/inputs/channels/1/overlays')
          .reply(200, overlayPayload);

        const device = new HikvisionDevice(defaultConfig);

        const config = await device.getOverlayConfiguration(1);

        expect(config).to.deep.equal({
          normalizedScreenSize: {
            width: 704,
            height: 480,
          },
          textOverlay: [
            {
              enabled: true,
              text: 'SMART SAMPA',
              positionX: 0,
              positionY: 480,
            }
          ],
          dateTimeOverlay: {
            enabled: true,
            positionX: 550,
            positionY: 480,
            dateFormat: 'DD-MM-YYYY',
            timeFormat: '24hour',
            displayWeek: false,
          },
          channelNameOverlay: {
            enabled: false,
          },
          style: {
            fontSize: '32*32',
            alignment: 'customize',
          }
        });
      });

      it('throws HttpRequestError when getOverlayConfiguration request fails', async () => {
        nock('http://hikvision.test:80')
          .get('/ISAPI/System/Video/inputs/channels/1/overlays')
          .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.getOverlayConfiguration(1);
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('updates overlay configuration using current camera payload', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <VideoOverlay>
          <normalizedScreenSize>
            <normalizedScreenWidth>704</normalizedScreenWidth>
            <normalizedScreenHeight>480</normalizedScreenHeight>
          </normalizedScreenSize>
          <TextOverlayList size="1">
            <TextOverlay>
              <id>1</id>
              <enabled>true</enabled>
              <positionX>0</positionX>
              <positionY>480</positionY>
              <displayText>OLD TEXT</displayText>
            </TextOverlay>
          </TextOverlayList>
          <DateTimeOverlay>
            <enabled>true</enabled>
            <positionX>550</positionX>
            <positionY>480</positionY>
            <dateStyle>DD-MM-YYYY</dateStyle>
            <timeStyle>24hour</timeStyle>
            <displayWeek>false</displayWeek>
          </DateTimeOverlay>
          <channelNameOverlay>
            <enabled>false</enabled>
            <positionX>628</positionX>
            <positionY>64</positionY>
          </channelNameOverlay>
          <fontSize>32*32</fontSize>
          <alignment>customize</alignment>
        </VideoOverlay>`;

        const putResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <statusString>OK</statusString>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        let putBody = '';

        nock('http://hikvision.test:80')
          .get('/ISAPI/System/Video/inputs/channels/1/overlays')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/System/Video/inputs/channels/1/overlays', (body: string) => {
            putBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        const device = new HikvisionDevice(defaultConfig);

        await device.setOverlayConfiguration(1, {
          normalizedScreenSize: {
            width: 1000,
            height: 1000,
          },
          textOverlay: [
            {
              enabled: true,
              text: 'SMART SAMPA',
              positionX: 10,
              positionY: 20,
            },
            {
              enabled: false,
              text: 'SECOND',
              positionX: 30,
              positionY: 40,
            }
          ],
          dateTimeOverlay: {
            enabled: false,
            positionX: 123,
            positionY: 321,
            dateFormat: 'YYYY-MM-DD',
            timeFormat: '12hour',
            displayWeek: true,
          },
          channelNameOverlay: {
            enabled: true,
          },
          style: {
            fontSize: '16*16',
            alignment: 'alignLeft',
          }
        });

        expect(putBody).to.include('<TextOverlayList size="2">');
        expect(putBody).to.include('<id>1</id>');
        expect(putBody).to.include('<id>2</id>');
        expect(putBody).to.include('<displayText>SMART SAMPA</displayText>');
        expect(putBody).to.include('<displayText>SECOND</displayText>');
        expect(putBody).to.include('<dateStyle>YYYY-MM-DD</dateStyle>');
        expect(putBody).to.include('<timeStyle>12hour</timeStyle>');
        expect(putBody).to.include('<displayWeek>true</displayWeek>');
        expect(putBody).to.include('<fontSize>16*16</fontSize>');
        expect(putBody).to.include('<alignment>alignLeft</alignment>');
      });

      it('throws HttpRequestError when setOverlayConfiguration response is invalid', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <VideoOverlay>
          <normalizedScreenSize>
            <normalizedScreenWidth>704</normalizedScreenWidth>
            <normalizedScreenHeight>480</normalizedScreenHeight>
          </normalizedScreenSize>
        </VideoOverlay>`;

        const invalidPutResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>2</statusCode>
          <subStatusCode>error</subStatusCode>
        </ResponseStatus>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/System/Video/inputs/channels/1/overlays')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/System/Video/inputs/channels/1/overlays')
          .reply(200, invalidPutResponse);

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setOverlayConfiguration(1, {
            style: {
              fontSize: '32*32',
              alignment: 'customize',
            }
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('returns parsed capabilities from camera payload', async () => {
        const capabilitiesPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <DeviceCap>
          <SmartCap>
            <isSupportDefocusDetection>true</isSupportDefocusDetection>
            <isSupportSceneChangeDetection>false</isSupportSceneChangeDetection>
          </SmartCap>
        </DeviceCap>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/System/capabilities')
          .reply(200, capabilitiesPayload);

        const device = new HikvisionDevice(defaultConfig);

        const capabilities = await device.getCapabilities();

        expect(capabilities).to.deep.equal({
          defocus: true,
          sceneChange: false,
        });
      });

      it('throws HttpRequestError when getCapabilities request fails', async () => {
        nock('http://hikvision.test:80')
          .get('/ISAPI/System/capabilities')
          .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.getCapabilities();
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('updates defocus configuration when values differ', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <DefocusDetection>
          <id>1</id>
          <enabled>true</enabled>
          <sensitivityLevel>55</sensitivityLevel>
        </DefocusDetection>`;

        const putResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        let putBody = '';

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/DefocusDetection/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/DefocusDetection/1', (body: string) => {
            putBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        const device = new HikvisionDevice(defaultConfig);

        await device.setDefocusConfiguration({
          enabled: false,
          sensitivityLevel: 10,
        });

        expect(putBody).to.include('<enabled>false</enabled>');
        expect(putBody).to.include('<sensitivityLevel>10</sensitivityLevel>');
      });

      it('does not send defocus configuration update when values are unchanged', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <DefocusDetection>
          <id>1</id>
          <enabled>true</enabled>
          <sensitivityLevel>55</sensitivityLevel>
        </DefocusDetection>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/DefocusDetection/1')
          .reply(200, getPayload);

        const device = new HikvisionDevice(defaultConfig);

        await device.setDefocusConfiguration({
          enabled: true,
          sensitivityLevel: 55,
        });
      });

      it('updates defocus trigger notifications based on requested outputs', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <EventTrigger>
          <id>defocus-1</id>
          <eventType>defocus</eventType>
          <EventTriggerNotificationList>
            <EventTriggerNotification>
              <id>center</id>
              <notificationMethod>center</notificationMethod>
              <notificationRecurrence>beginning</notificationRecurrence>
            </EventTriggerNotification>
          </EventTriggerNotificationList>
        </EventTrigger>`;

        const putResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        let putBody = '';

        nock('http://hikvision.test:80')
          .get('/ISAPI/Event/triggers/defocus-1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Event/triggers/defocus-1', (body: string) => {
            putBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        const device = new HikvisionDevice(defaultConfig);

        await device.setDefocusTriggerConfiguration({
          surveillanceCenter: false,
          email: true,
          io: true,
        });

        expect(putBody).to.include('<notificationMethod>email</notificationMethod>');
        expect(putBody).to.include('<notificationMethod>IO</notificationMethod>');
        expect(putBody).to.include('<outputIOPortID>1</outputIOPortID>');
        expect(putBody).to.not.include('<notificationMethod>center</notificationMethod>');
      });

      it('throws HttpRequestError when defocus trigger update response is invalid', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <EventTrigger>
          <id>defocus-1</id>
          <eventType>defocus</eventType>
          <EventTriggerNotificationList>
            <EventTriggerNotification>
              <id>center</id>
              <notificationMethod>center</notificationMethod>
              <notificationRecurrence>beginning</notificationRecurrence>
            </EventTriggerNotification>
          </EventTriggerNotificationList>
        </EventTrigger>`;

        const invalidPutResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>2</statusCode>
          <subStatusCode>error</subStatusCode>
        </ResponseStatus>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/Event/triggers/defocus-1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Event/triggers/defocus-1')
          .reply(200, invalidPutResponse);

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setDefocusTriggerConfiguration({
            surveillanceCenter: true,
            email: true,
            io: false,
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('updates scene change configuration when values differ', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <SceneChangeDetection>
          <id>1</id>
          <enabled>false</enabled>
          <sensitivityLevel>55</sensitivityLevel>
        </SceneChangeDetection>`;

        const putResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        let putBody = '';

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/SceneChangeDetection/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/SceneChangeDetection/1', (body: string) => {
            putBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        const device = new HikvisionDevice(defaultConfig);

        await device.setSceneChangeConfiguration({
          enabled: true,
          sensitivityLevel: 33,
        });

        expect(putBody).to.include('<enabled>true</enabled>');
        expect(putBody).to.include('<sensitivityLevel>33</sensitivityLevel>');
      });

      it('does not send scene change configuration update when values are unchanged', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <SceneChangeDetection>
          <id>1</id>
          <enabled>false</enabled>
          <sensitivityLevel>55</sensitivityLevel>
        </SceneChangeDetection>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/SceneChangeDetection/1')
          .reply(200, getPayload);

        const device = new HikvisionDevice(defaultConfig);

        await device.setSceneChangeConfiguration({
          enabled: false,
          sensitivityLevel: 55,
        });
      });

      it('updates scene change trigger notifications based on requested outputs', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <EventTrigger>
          <id>scenechangedetection-1</id>
          <eventType>scenechangedetection</eventType>
          <EventTriggerNotificationList>
            <EventTriggerNotification>
              <id>center</id>
              <notificationMethod>center</notificationMethod>
              <notificationRecurrence>beginning</notificationRecurrence>
            </EventTriggerNotification>
          </EventTriggerNotificationList>
        </EventTrigger>`;

        const putResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        let putBody = '';

        nock('http://hikvision.test:80')
          .get('/ISAPI/Event/triggers/scenechangedetection-1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Event/triggers/scenechangedetection-1', (body: string) => {
            putBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        const device = new HikvisionDevice(defaultConfig);

        await device.setSceneChangeTriggerConfiguration({
          surveillanceCenter: false,
          email: true,
        });

        expect(putBody).to.include('<notificationMethod>email</notificationMethod>');
        expect(putBody).to.not.include('<notificationMethod>center</notificationMethod>');
      });

      it('throws HttpRequestError when scene change trigger get request fails', async () => {
        nock('http://hikvision.test:80')
          .get('/ISAPI/Event/triggers/scenechangedetection-1')
          .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setSceneChangeTriggerConfiguration({
            surveillanceCenter: true,
            email: false,
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('returns parsed device information from camera payload', async () => {
        const payload = `<?xml version="1.0" encoding="UTF-8"?>
        <DeviceInfo version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
          <deviceName>L55759476</deviceName>
          <model>DS-2CD3066G2-IS</model>
          <serialNumber>DS-2CD3066G2-IS20240108AAWRL55759476</serialNumber>
          <firmwareVersion>V5.7.52</firmwareVersion>
        </DeviceInfo>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/System/deviceInfo')
          .reply(200, payload);

        const device = new HikvisionDevice(defaultConfig);

        const information = await device.getDeviceInformation();

        expect(information).to.deep.equal({
          deviceName: 'L55759476',
          model: 'DS-2CD3066G2-IS',
          serialNumber: 'DS-2CD3066G2-IS20240108AAWRL55759476',
          firmwareVersion: 'V5.7.52',
        });
      });

      it('throws HttpRequestError when getDeviceInformation request fails', async () => {
        nock('http://hikvision.test:80')
          .get('/ISAPI/System/deviceInfo')
          .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.getDeviceInformation();
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('updates field detection configuration and schedule using camera payload', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <FieldDetection version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
          <id>1</id>
          <enabled>true</enabled>
          <FieldDetectionRegionList size="2">
            <FieldDetectionRegion>
              <id>1</id>
              <enabled>false</enabled>
              <sensitivityLevel>50</sensitivityLevel>
              <timeThreshold>0</timeThreshold>
              <detectionTarget>human</detectionTarget>
              <alarmConfidence opt="low,mediumLow,mediumHigh,high">low</alarmConfidence>
            </FieldDetectionRegion>
            <FieldDetectionRegion>
              <id>2</id>
              <enabled>false</enabled>
              <sensitivityLevel>50</sensitivityLevel>
              <timeThreshold>0</timeThreshold>
              <detectionTarget>human</detectionTarget>
              <alarmConfidence opt="low,mediumLow,mediumHigh,high">low</alarmConfidence>
            </FieldDetectionRegion>
          </FieldDetectionRegionList>
        </FieldDetection>`;

        const putResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        let fieldDetectionPutBody = '';
        let schedulePutBody = '';

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/FieldDetection/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/FieldDetection/1', (body: string) => {
            fieldDetectionPutBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Event/schedules/fieldDetections/fielddetection_video1', (body: string) => {
            schedulePutBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        const device = new HikvisionDevice(defaultConfig);

        await device.setFieldDetectionConfiguration({
          enabled: false,
          regions: [
            {
              id: 1,
              sensitivityLevel: 25,
              detectionTarget: ['human', 'vehicle'],
              timeThreshold: 15,
              confidenceLevel: 'mediumHigh'
            }
          ],
          schedule: {
            monday: { start: '01:00:00', end: '02:00:00' },
            tuesday: { start: '03:00:00', end: '04:00:00' },
            wednesday: { start: '05:00:00', end: '06:00:00' },
            thursday: { start: '07:00:00', end: '08:00:00' },
            friday: { start: '09:00:00', end: '10:00:00' },
            saturday: { start: '11:00:00', end: '12:00:00' },
            sunday: { start: '13:00:00', end: '24:00:00' },
          }
        });

        expect(fieldDetectionPutBody).to.include('<enabled>false</enabled>');
        expect(fieldDetectionPutBody).to.include('<sensitivityLevel>25</sensitivityLevel>');
        expect(fieldDetectionPutBody).to.include('<timeThreshold>15</timeThreshold>');
        expect(fieldDetectionPutBody).to.include('<detectionTarget>human,vehicle</detectionTarget>');
        expect(fieldDetectionPutBody).to.include('<alarmConfidence>mediumHigh</alarmConfidence>');

        expect(schedulePutBody).to.include('<id>fielddetection_video1</id>');
        expect(schedulePutBody).to.include('<eventType>fielddetection</eventType>');
        expect(schedulePutBody).to.include('<TimeBlockList size="8">');
        expect(schedulePutBody).to.include('<dayOfWeek>1</dayOfWeek>');
        expect(schedulePutBody).to.include('<beginTime>01:00:00</beginTime>');
        expect(schedulePutBody).to.include('<endTime>02:00:00</endTime>');
        expect(schedulePutBody).to.include('<dayOfWeek>7</dayOfWeek>');
        expect(schedulePutBody).to.include('<beginTime>13:00:00</beginTime>');
        expect(schedulePutBody).to.include('<endTime>24:00:00</endTime>');
      });

      it('updates field detection configuration without schedule update when schedule is not provided', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <FieldDetection>
          <enabled>true</enabled>
          <FieldDetectionRegionList>
            <FieldDetectionRegion>
              <id>1</id>
              <sensitivityLevel>50</sensitivityLevel>
              <timeThreshold>0</timeThreshold>
              <detectionTarget>human</detectionTarget>
              <alarmConfidence>low</alarmConfidence>
            </FieldDetectionRegion>
          </FieldDetectionRegionList>
        </FieldDetection>`;

        const putResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        let fieldDetectionPutBody = '';

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/FieldDetection/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/FieldDetection/1', (body: string) => {
            fieldDetectionPutBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        const device = new HikvisionDevice(defaultConfig);

        await device.setFieldDetectionConfiguration({
          enabled: true,
          regions: [
            {
              id: 1,
              sensitivityLevel: 60,
              confidenceLevel: 'high'
            }
          ]
        });

        expect(fieldDetectionPutBody).to.include('<sensitivityLevel>60</sensitivityLevel>');
        expect(fieldDetectionPutBody).to.include('<alarmConfidence>high</alarmConfidence>');
      });

      it('throws HttpRequestError when field detection configuration get request fails', async () => {
        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/FieldDetection/1')
          .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setFieldDetectionConfiguration({
            enabled: true,
            regions: []
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('throws HttpRequestError when field detection configuration update response is invalid', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <FieldDetection>
          <enabled>true</enabled>
          <FieldDetectionRegionList>
            <FieldDetectionRegion>
              <id>1</id>
            </FieldDetectionRegion>
          </FieldDetectionRegionList>
        </FieldDetection>`;

        const invalidPutResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>2</statusCode>
          <subStatusCode>error</subStatusCode>
        </ResponseStatus>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/FieldDetection/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/FieldDetection/1')
          .reply(200, invalidPutResponse);

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setFieldDetectionConfiguration({
            enabled: false,
            regions: [
              {
                id: 1,
                sensitivityLevel: 10
              }
            ]
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('throws HttpRequestError when field detection schedule update response is invalid', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <FieldDetection>
          <enabled>true</enabled>
          <FieldDetectionRegionList>
            <FieldDetectionRegion>
              <id>1</id>
            </FieldDetectionRegion>
          </FieldDetectionRegionList>
        </FieldDetection>`;

        const okPutResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        const invalidPutResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>2</statusCode>
          <subStatusCode>error</subStatusCode>
        </ResponseStatus>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/FieldDetection/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/FieldDetection/1')
          .reply(200, okPutResponse);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Event/schedules/fieldDetections/fielddetection_video1')
          .reply(200, invalidPutResponse);

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setFieldDetectionConfiguration({
            enabled: true,
            regions: [],
            schedule: {
              monday: { start: '00:00:00', end: '24:00:00' },
              tuesday: { start: '00:00:00', end: '24:00:00' },
              wednesday: { start: '00:00:00', end: '24:00:00' },
              thursday: { start: '00:00:00', end: '24:00:00' },
              friday: { start: '00:00:00', end: '24:00:00' },
              saturday: { start: '00:00:00', end: '24:00:00' },
              sunday: { start: '00:00:00', end: '24:00:00' },
            }
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('updates line crossing configuration and schedule using camera payload', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <LineDetection>
          <id>1</id>
          <enabled>true</enabled>
          <LineItemList size="2">
            <LineItem>
              <id>1</id>
              <sensitivityLevel>55</sensitivityLevel>
              <directionSensitivity>any</directionSensitivity>
              <detectionTarget>human</detectionTarget>
              <alarmConfidence>low</alarmConfidence>
            </LineItem>
            <LineItem>
              <id>2</id>
              <sensitivityLevel>50</sensitivityLevel>
              <directionSensitivity>any</directionSensitivity>
              <detectionTarget>human</detectionTarget>
              <alarmConfidence>low</alarmConfidence>
            </LineItem>
          </LineItemList>
        </LineDetection>`;

        const putResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        let lineCrossingPutBody = '';
        let schedulePutBody = '';

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/LineDetection/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/LineDetection/1', (body: string) => {
            lineCrossingPutBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Event/schedules/lineDetections/linedetection_video1', (body: string) => {
            schedulePutBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        const device = new HikvisionDevice(defaultConfig);

        await device.setLineCrossingConfiguration({
          enabled: false,
          regions: [
            {
              id: 1,
              sensitivityLevel: 25,
              detectionTarget: ['human', 'vehicle'],
              crossingDirection: 'left-right',
              confidenceLevel: 'mediumHigh'
            }
          ],
          schedule: {
            monday: { start: '01:00:00', end: '02:00:00' },
            tuesday: { start: '03:00:00', end: '04:00:00' },
            wednesday: { start: '05:00:00', end: '06:00:00' },
            thursday: { start: '07:00:00', end: '08:00:00' },
            friday: { start: '09:00:00', end: '10:00:00' },
            saturday: { start: '11:00:00', end: '12:00:00' },
            sunday: { start: '13:00:00', end: '24:00:00' },
          }
        });

        expect(lineCrossingPutBody).to.include('<enabled>false</enabled>');
        expect(lineCrossingPutBody).to.include('<sensitivityLevel>25</sensitivityLevel>');
        expect(lineCrossingPutBody).to.include('<directionSensitivity>left-right</directionSensitivity>');
        expect(lineCrossingPutBody).to.include('<detectionTarget>human,vehicle</detectionTarget>');
        expect(lineCrossingPutBody).to.include('<alarmConfidence>mediumHigh</alarmConfidence>');

        expect(schedulePutBody).to.include('<id>linedetection_video1</id>');
        expect(schedulePutBody).to.include('<eventType>linedetection</eventType>');
        expect(schedulePutBody).to.include('<TimeBlockList size="8">');
        expect(schedulePutBody).to.include('<dayOfWeek>1</dayOfWeek>');
        expect(schedulePutBody).to.include('<beginTime>01:00:00</beginTime>');
        expect(schedulePutBody).to.include('<endTime>02:00:00</endTime>');
      });

      it('updates line crossing configuration without schedule update when schedule is not provided', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <LineDetection>
          <enabled>true</enabled>
          <LineItemList>
            <LineItem>
              <id>1</id>
              <sensitivityLevel>50</sensitivityLevel>
              <directionSensitivity>any</directionSensitivity>
              <detectionTarget>human</detectionTarget>
              <alarmConfidence>low</alarmConfidence>
            </LineItem>
          </LineItemList>
        </LineDetection>`;

        const putResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        let lineCrossingPutBody = '';

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/LineDetection/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/LineDetection/1', (body: string) => {
            lineCrossingPutBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        const device = new HikvisionDevice(defaultConfig);

        await device.setLineCrossingConfiguration({
          enabled: true,
          regions: [
            {
              id: 1,
              crossingDirection: 'right-left',
              confidenceLevel: 'high'
            }
          ]
        });

        expect(lineCrossingPutBody).to.include('<directionSensitivity>right-left</directionSensitivity>');
        expect(lineCrossingPutBody).to.include('<alarmConfidence>high</alarmConfidence>');
      });

      it('throws HttpRequestError when line crossing configuration get request fails', async () => {
        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/LineDetection/1')
          .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setLineCrossingConfiguration({
            enabled: true,
            regions: []
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('throws HttpRequestError when line crossing configuration update response is invalid', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <LineDetection>
          <enabled>true</enabled>
          <LineItemList>
            <LineItem>
              <id>1</id>
            </LineItem>
          </LineItemList>
        </LineDetection>`;

        const invalidPutResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>2</statusCode>
          <subStatusCode>error</subStatusCode>
        </ResponseStatus>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/LineDetection/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/LineDetection/1')
          .reply(200, invalidPutResponse);

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setLineCrossingConfiguration({
            enabled: false,
            regions: [
              {
                id: 1,
                sensitivityLevel: 10
              }
            ]
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('throws HttpRequestError when line crossing schedule update response is invalid', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <LineDetection>
          <enabled>true</enabled>
          <LineItemList>
            <LineItem>
              <id>1</id>
            </LineItem>
          </LineItemList>
        </LineDetection>`;

        const okPutResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        const invalidPutResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>2</statusCode>
          <subStatusCode>error</subStatusCode>
        </ResponseStatus>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/LineDetection/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/LineDetection/1')
          .reply(200, okPutResponse);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Event/schedules/lineDetections/linedetection_video1')
          .reply(200, invalidPutResponse);

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setLineCrossingConfiguration({
            enabled: true,
            regions: [],
            schedule: {
              monday: { start: '00:00:00', end: '24:00:00' },
              tuesday: { start: '00:00:00', end: '24:00:00' },
              wednesday: { start: '00:00:00', end: '24:00:00' },
              thursday: { start: '00:00:00', end: '24:00:00' },
              friday: { start: '00:00:00', end: '24:00:00' },
              saturday: { start: '00:00:00', end: '24:00:00' },
              sunday: { start: '00:00:00', end: '24:00:00' },
            }
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('updates region entrance configuration and schedule using camera payload', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <RegionEntrance>
          <id>1</id>
          <enabled>true</enabled>
          <RegionEntranceRegionList size="2">
            <RegionEntranceRegion>
              <id>1</id>
              <sensitivityLevel>55</sensitivityLevel>
              <detectionTarget>human</detectionTarget>
              <alarmConfidence>low</alarmConfidence>
            </RegionEntranceRegion>
            <RegionEntranceRegion>
              <id>2</id>
              <sensitivityLevel>50</sensitivityLevel>
              <detectionTarget>human</detectionTarget>
              <alarmConfidence>low</alarmConfidence>
            </RegionEntranceRegion>
          </RegionEntranceRegionList>
        </RegionEntrance>`;

        const putResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        let regionEntrancePutBody = '';
        let schedulePutBody = '';

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/regionEntrance/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/regionEntrance/1', (body: string) => {
            regionEntrancePutBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Event/schedules/regionEntrances/regionEntrance-1', (body: string) => {
            schedulePutBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        const device = new HikvisionDevice(defaultConfig);

        await device.setRegionEntranceConfiguration({
          enabled: false,
          regions: [
            {
              id: 1,
              sensitivityLevel: 20,
              detectionTarget: ['human', 'vehicle'],
              confidenceLevel: 'mediumHigh'
            }
          ],
          schedule: {
            monday: { start: '01:00:00', end: '02:00:00' },
            tuesday: { start: '03:00:00', end: '04:00:00' },
            wednesday: { start: '05:00:00', end: '06:00:00' },
            thursday: { start: '07:00:00', end: '08:00:00' },
            friday: { start: '09:00:00', end: '10:00:00' },
            saturday: { start: '11:00:00', end: '12:00:00' },
            sunday: { start: '13:00:00', end: '24:00:00' },
          }
        });

        expect(regionEntrancePutBody).to.include('<enabled>false</enabled>');
        expect(regionEntrancePutBody).to.include('<sensitivityLevel>20</sensitivityLevel>');
        expect(regionEntrancePutBody).to.include('<detectionTarget>human,vehicle</detectionTarget>');
        expect(regionEntrancePutBody).to.include('<alarmConfidence>mediumHigh</alarmConfidence>');

        expect(schedulePutBody).to.include('<id>regionEntrance-1</id>');
        expect(schedulePutBody).to.include('<eventType>regionEntrance</eventType>');
        expect(schedulePutBody).to.include('<TimeBlockList size="8">');
        expect(schedulePutBody).to.include('<beginTime>01:00:00</beginTime>');
      });

      it('updates region entrance configuration without schedule update when schedule is not provided', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <RegionEntrance>
          <enabled>true</enabled>
          <RegionEntranceRegionList>
            <RegionEntranceRegion>
              <id>1</id>
              <sensitivityLevel>50</sensitivityLevel>
              <detectionTarget>human</detectionTarget>
              <alarmConfidence>low</alarmConfidence>
            </RegionEntranceRegion>
          </RegionEntranceRegionList>
        </RegionEntrance>`;

        const putResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        let regionEntrancePutBody = '';

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/regionEntrance/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/regionEntrance/1', (body: string) => {
            regionEntrancePutBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        const device = new HikvisionDevice(defaultConfig);

        await device.setRegionEntranceConfiguration({
          enabled: true,
          regions: [
            {
              id: 1,
              sensitivityLevel: 70,
              confidenceLevel: 'high'
            }
          ]
        });

        expect(regionEntrancePutBody).to.include('<sensitivityLevel>70</sensitivityLevel>');
        expect(regionEntrancePutBody).to.include('<alarmConfidence>high</alarmConfidence>');
      });

      it('throws HttpRequestError when region entrance configuration get request fails', async () => {
        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/regionEntrance/1')
          .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setRegionEntranceConfiguration({
            enabled: true,
            regions: []
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('throws HttpRequestError when region entrance configuration update response is invalid', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <RegionEntrance>
          <enabled>true</enabled>
          <RegionEntranceRegionList>
            <RegionEntranceRegion>
              <id>1</id>
            </RegionEntranceRegion>
          </RegionEntranceRegionList>
        </RegionEntrance>`;

        const invalidPutResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>2</statusCode>
          <subStatusCode>error</subStatusCode>
        </ResponseStatus>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/regionEntrance/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/regionEntrance/1')
          .reply(200, invalidPutResponse);

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setRegionEntranceConfiguration({
            enabled: false,
            regions: [
              {
                id: 1,
                sensitivityLevel: 10
              }
            ]
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('throws HttpRequestError when region entrance schedule update response is invalid', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <RegionEntrance>
          <enabled>true</enabled>
          <RegionEntranceRegionList>
            <RegionEntranceRegion>
              <id>1</id>
            </RegionEntranceRegion>
          </RegionEntranceRegionList>
        </RegionEntrance>`;

        const okPutResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        const invalidPutResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>2</statusCode>
          <subStatusCode>error</subStatusCode>
        </ResponseStatus>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/regionEntrance/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/regionEntrance/1')
          .reply(200, okPutResponse);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Event/schedules/regionEntrances/regionEntrance-1')
          .reply(200, invalidPutResponse);

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setRegionEntranceConfiguration({
            enabled: true,
            regions: [],
            schedule: {
              monday: { start: '00:00:00', end: '24:00:00' },
              tuesday: { start: '00:00:00', end: '24:00:00' },
              wednesday: { start: '00:00:00', end: '24:00:00' },
              thursday: { start: '00:00:00', end: '24:00:00' },
              friday: { start: '00:00:00', end: '24:00:00' },
              saturday: { start: '00:00:00', end: '24:00:00' },
              sunday: { start: '00:00:00', end: '24:00:00' },
            }
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('updates region exiting configuration and schedule using camera payload', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <RegionExiting>
          <id>1</id>
          <enabled>true</enabled>
          <RegionExitingRegionList size="2">
            <RegionExitingRegion>
              <id>1</id>
              <sensitivityLevel>55</sensitivityLevel>
              <detectionTarget>human</detectionTarget>
              <alarmConfidence>low</alarmConfidence>
            </RegionExitingRegion>
            <RegionExitingRegion>
              <id>2</id>
              <sensitivityLevel>50</sensitivityLevel>
              <detectionTarget>human</detectionTarget>
              <alarmConfidence>low</alarmConfidence>
            </RegionExitingRegion>
          </RegionExitingRegionList>
        </RegionExiting>`;

        const putResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        let regionExitingPutBody = '';
        let schedulePutBody = '';

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/regionExiting/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/regionExiting/1', (body: string) => {
            regionExitingPutBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Event/schedules/regionExitings/regionExiting-1', (body: string) => {
            schedulePutBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        const device = new HikvisionDevice(defaultConfig);

        await device.setRegionExitingConfiguration({
          enabled: false,
          regions: [
            {
              id: 1,
              sensitivityLevel: 20,
              detectionTarget: ['human', 'vehicle'],
              confidenceLevel: 'mediumHigh'
            }
          ],
          schedule: {
            monday: { start: '01:00:00', end: '02:00:00' },
            tuesday: { start: '03:00:00', end: '04:00:00' },
            wednesday: { start: '05:00:00', end: '06:00:00' },
            thursday: { start: '07:00:00', end: '08:00:00' },
            friday: { start: '09:00:00', end: '10:00:00' },
            saturday: { start: '11:00:00', end: '12:00:00' },
            sunday: { start: '13:00:00', end: '24:00:00' },
          }
        });

        expect(regionExitingPutBody).to.include('<enabled>false</enabled>');
        expect(regionExitingPutBody).to.include('<sensitivityLevel>20</sensitivityLevel>');
        expect(regionExitingPutBody).to.include('<detectionTarget>human,vehicle</detectionTarget>');
        expect(regionExitingPutBody).to.include('<alarmConfidence>mediumHigh</alarmConfidence>');

        expect(schedulePutBody).to.include('<id>regionExiting-1</id>');
        expect(schedulePutBody).to.include('<eventType>regionExiting</eventType>');
        expect(schedulePutBody).to.include('<TimeBlockList size="8">');
        expect(schedulePutBody).to.include('<beginTime>01:00:00</beginTime>');
      });

      it('updates region exiting configuration without schedule update when schedule is not provided', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <RegionExiting>
          <enabled>true</enabled>
          <RegionExitingRegionList>
            <RegionExitingRegion>
              <id>1</id>
              <sensitivityLevel>50</sensitivityLevel>
              <detectionTarget>human</detectionTarget>
              <alarmConfidence>low</alarmConfidence>
            </RegionExitingRegion>
          </RegionExitingRegionList>
        </RegionExiting>`;

        const putResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        let regionExitingPutBody = '';

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/regionExiting/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/regionExiting/1', (body: string) => {
            regionExitingPutBody = String(body);
            return true;
          })
          .reply(200, putResponse);

        const device = new HikvisionDevice(defaultConfig);

        await device.setRegionExitingConfiguration({
          enabled: true,
          regions: [
            {
              id: 1,
              sensitivityLevel: 70,
              confidenceLevel: 'high'
            }
          ]
        });

        expect(regionExitingPutBody).to.include('<sensitivityLevel>70</sensitivityLevel>');
        expect(regionExitingPutBody).to.include('<alarmConfidence>high</alarmConfidence>');
      });

      it('throws HttpRequestError when region exiting configuration get request fails', async () => {
        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/regionExiting/1')
          .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setRegionExitingConfiguration({
            enabled: true,
            regions: []
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('throws HttpRequestError when region exiting configuration update response is invalid', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <RegionExiting>
          <enabled>true</enabled>
          <RegionExitingRegionList>
            <RegionExitingRegion>
              <id>1</id>
            </RegionExitingRegion>
          </RegionExitingRegionList>
        </RegionExiting>`;

        const invalidPutResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>2</statusCode>
          <subStatusCode>error</subStatusCode>
        </ResponseStatus>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/regionExiting/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/regionExiting/1')
          .reply(200, invalidPutResponse);

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setRegionExitingConfiguration({
            enabled: false,
            regions: [
              {
                id: 1,
                sensitivityLevel: 10
              }
            ]
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('throws HttpRequestError when region exiting schedule update response is invalid', async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <RegionExiting>
          <enabled>true</enabled>
          <RegionExitingRegionList>
            <RegionExitingRegion>
              <id>1</id>
            </RegionExitingRegion>
          </RegionExitingRegionList>
        </RegionExiting>`;

        const okPutResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        const invalidPutResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>2</statusCode>
          <subStatusCode>error</subStatusCode>
        </ResponseStatus>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/Smart/regionExiting/1')
          .reply(200, getPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Smart/regionExiting/1')
          .reply(200, okPutResponse);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Event/schedules/regionExitings/regionExiting-1')
          .reply(200, invalidPutResponse);

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setRegionExitingConfiguration({
            enabled: true,
            regions: [],
            schedule: {
              monday: { start: '00:00:00', end: '24:00:00' },
              tuesday: { start: '00:00:00', end: '24:00:00' },
              wednesday: { start: '00:00:00', end: '24:00:00' },
              thursday: { start: '00:00:00', end: '24:00:00' },
              friday: { start: '00:00:00', end: '24:00:00' },
              saturday: { start: '00:00:00', end: '24:00:00' },
              sunday: { start: '00:00:00', end: '24:00:00' },
            }
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('updates face detection configuration including schedule, picture settings and webhooks', async () => {
        const customAppsPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <AppList version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
          <App>
            <id>1</id>
            <packageName>Face Capture</packageName>
            <runStatus>false</runStatus>
          </App>
          <App>
            <id>2</id>
            <packageName>Smart Event</packageName>
            <runStatus>false</runStatus>
          </App>
        </AppList>`;

        const faceRulePayload = `<?xml version="1.0" encoding="UTF-8"?>
        <FaceRule>
          <enabled>false</enabled>
        </FaceRule>`;

        const okResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        let faceRulePutBody = '';
        let schedulePutBody = '';
        let overlapPicPutBody: unknown;
        const webhookBodies: string[] = [];

        nock('http://hikvision.test:80')
          .get('/ISAPI/Custom/OpenPlatform/App')
          .reply(200, customAppsPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Custom/OpenPlatform/App/1/start')
          .reply(200, okResponse);

        nock('http://hikvision.test:80')
          .get('/ISAPI/Intelligent/channels/1/faceRule')
          .reply(200, faceRulePayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Intelligent/channels/1/faceRule', (body: string) => {
            faceRulePutBody = String(body);
            return true;
          })
          .reply(200, okResponse);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Event/schedules/faceSnap/faceSnap-1', (body: string) => {
            schedulePutBody = String(body);
            return true;
          })
          .reply(200, okResponse);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Intelligent/channels/1/faceSnap/overlapPic', (body: unknown) => {
            overlapPicPutBody = body;
            return true;
          })
          .query({ format: 'json' })
          .reply(200, {
            statusCode: 1,
            subStatusCode: 'ok'
          });

        nock('http://hikvision.test:80')
          .put('/ISAPI/Event/notification/httpHosts', (body: string) => {
            webhookBodies.push(String(body));
            return true;
          })
          .times(2)
          .reply(200, okResponse);

        const device = new HikvisionDevice(defaultConfig);

        await device.setFaceDetectionConfiguration({
          enabled: true,
          schedule: {
            monday: { start: '01:00:00', end: '02:00:00' },
            tuesday: { start: '03:00:00', end: '04:00:00' },
            wednesday: { start: '05:00:00', end: '06:00:00' },
            thursday: { start: '07:00:00', end: '08:00:00' },
            friday: { start: '09:00:00', end: '10:00:00' },
            saturday: { start: '11:00:00', end: '12:00:00' },
            sunday: { start: '13:00:00', end: '14:00:00' }
          },
          pictureConfiguration: {
            overlay: {
              displayVCAOnStream: true,
              displayTargetOnAlarm: false
            },
            pictureUpload: {
              uploadBackground: false,
              uploadFacePicture: true,
              quality: 'best',
              resolution: {
                width: 1920,
                height: 1080
              }
            },
            pictureSettings: {
              mode: 'custom',
              faceDimensions: {
                width: 1.8,
                height: 1.6,
                bodyHeight: 0.5
              },
              faceBeautification: {
                enabled: true,
                level: 50
              },
              fixedPictureHeight: {
                enabled: true,
                height: 220
              },
              textOverlays: [
                {
                  enabled: true,
                  index: 'snapTimeOsd',
                  value: ''
                },
                {
                  enabled: false,
                  index: 'cameraNo',
                  value: 'CAM-1'
                }
              ]
            }
          },
          webhookNotification: [
            {
              id: 1,
              protocol: 'https',
              host: 'face-v2.sentinelx.com.br',
              path: '/hik_pro_connect',
              port: 443
            },
            {
              id: 2,
              protocol: 'http',
              host: 'example.test',
              path: '/hook',
              port: 80
            }
          ]
        });

        expect(faceRulePutBody).to.include('<enabled>true</enabled>');

        expect(schedulePutBody).to.include('<eventType>faceSnap</eventType>');
        expect(schedulePutBody).to.include('<dayOfWeek>1</dayOfWeek>');
        expect(schedulePutBody).to.include('<beginTime>01:00:00</beginTime>');
        expect(schedulePutBody).to.include('<endTime>02:00:00</endTime>');

        const overlapPayload = typeof overlapPicPutBody === 'string'
          ? JSON.parse(overlapPicPutBody)
          : overlapPicPutBody;
        expect(overlapPayload.OverlapPic.AddIntelInfo.streamWithIntelInfo).to.equal(true);
        expect(overlapPayload.OverlapPic.AddIntelInfo.alarmWithTargetInfo).to.equal(false);
        expect(overlapPayload.OverlapPic.TargetPicParam.targetPicMode).to.equal('custom');
        expect(overlapPayload.OverlapPic.AlarmPicParam.PicSize.width).to.equal(1920);
        expect(overlapPayload.OverlapPic.AlarmOsdParam[1].osdIndex).to.equal('cameraNo');
        expect(overlapPayload.OverlapPic.AlarmOsdParam[1].osdValue).to.equal('CAM-1');

        expect(webhookBodies).to.have.length(2);
        expect(webhookBodies[0]).to.include('<id>1</id>');
        expect(webhookBodies[0]).to.include('<protocolType>HTTPS</protocolType>');
        expect(webhookBodies[0]).to.include('<hostName>face-v2.sentinelx.com.br</hostName>');
        expect(webhookBodies[1]).to.include('<id>2</id>');
        expect(webhookBodies[1]).to.include('<protocolType>HTTP</protocolType>');
        expect(webhookBodies[1]).to.include('<hostName>example.test</hostName>');
      });

      it('disables face detection app and skips remaining updates', async () => {
        const customAppsPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <AppList version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
          <App>
            <id>1</id>
            <packageName>Face Capture</packageName>
            <runStatus>true</runStatus>
          </App>
        </AppList>`;

        const okResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/Custom/OpenPlatform/App')
          .reply(200, customAppsPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Custom/OpenPlatform/App/1/stop')
          .reply(200, okResponse);

        const device = new HikvisionDevice(defaultConfig);

        await device.setFaceDetectionConfiguration({
          enabled: false,
          schedule: {
            monday: { start: '00:00:00', end: '24:00:00' },
            tuesday: { start: '00:00:00', end: '24:00:00' },
            wednesday: { start: '00:00:00', end: '24:00:00' },
            thursday: { start: '00:00:00', end: '24:00:00' },
            friday: { start: '00:00:00', end: '24:00:00' },
            saturday: { start: '00:00:00', end: '24:00:00' },
            sunday: { start: '00:00:00', end: '24:00:00' }
          }
        });
      });

      it('throws MissingConfigurationError when Face Capture app is not available', async () => {
        const customAppsPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <AppList version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
          <App>
            <id>2</id>
            <packageName>Smart Event</packageName>
            <runStatus>false</runStatus>
          </App>
        </AppList>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/Custom/OpenPlatform/App')
          .reply(200, customAppsPayload);

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setFaceDetectionConfiguration({
            enabled: true
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(MissingConfigurationError);
        }
      });

      it('throws HttpRequestError when face detection app listing request fails', async () => {
        nock('http://hikvision.test:80')
          .get('/ISAPI/Custom/OpenPlatform/App')
          .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setFaceDetectionConfiguration({
            enabled: true
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('throws HttpRequestError when face detection schedule update response is invalid', async () => {
        const customAppsPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <AppList version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
          <App>
            <id>1</id>
            <packageName>Face Capture</packageName>
            <runStatus>true</runStatus>
          </App>
        </AppList>`;

        const faceRulePayload = `<?xml version="1.0" encoding="UTF-8"?>
        <FaceRule>
          <enabled>true</enabled>
        </FaceRule>`;

        const invalidResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>2</statusCode>
          <subStatusCode>error</subStatusCode>
        </ResponseStatus>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/Custom/OpenPlatform/App')
          .reply(200, customAppsPayload);

        nock('http://hikvision.test:80')
          .get('/ISAPI/Intelligent/channels/1/faceRule')
          .reply(200, faceRulePayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/Event/schedules/faceSnap/faceSnap-1')
          .reply(200, invalidResponse);

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setFaceDetectionConfiguration({
            enabled: true,
            schedule: {
              monday: { start: '00:00:00', end: '24:00:00' },
              tuesday: { start: '00:00:00', end: '24:00:00' },
              wednesday: { start: '00:00:00', end: '24:00:00' },
              thursday: { start: '00:00:00', end: '24:00:00' },
              friday: { start: '00:00:00', end: '24:00:00' },
              saturday: { start: '00:00:00', end: '24:00:00' },
              sunday: { start: '00:00:00', end: '24:00:00' },
            }
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('updates lpr configuration across upload, capture, vehicle, schedule, webhook and image upload sections', async () => {
        const okXmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
          <statusCode>1</statusCode>
          <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        const tpsPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <TPS>
          <enRealtimeDataUpload>false</enRealtimeDataUpload>
          <enStatisticalDataUpload>false</enStatisticalDataUpload>
          <posEnable>false</posEnable>
        </TPS>`;

        const platePayload = `<?xml version="1.0" encoding="UTF-8"?>
        <PlateRecognitionParam>
          <countryIndex>220</countryIndex>
        </PlateRecognitionParam>`;

        const carFeaturePayload = `<?xml version="1.0" encoding="UTF-8"?>
        <CarFeatureParam>
          <safetyBeltEnabled>true</safetyBeltEnabled>
          <callEnabled>true</callEnabled>
          <helmetEnabled>true</helmetEnabled>
        </CarFeatureParam>`;

        const capResPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <CapResolution>
          <capResolutionWidth>1920</capResolutionWidth>
          <capResolutionHeight>1080</capResolutionHeight>
        </CapResolution>`;

        let tpsPutBody = '';
        let platePutBody = '';
        let carFeaturePutBody = '';
        let capResPutBody = '';
        let schedulePutBody: unknown;
        let mixedTargetPutBody: unknown;
        const webhookBodies: string[] = [];

        nock('http://hikvision.test:80')
          .get('/ISAPI/ITC/TriggerMode/TPS')
          .reply(200, tpsPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/ITC/TriggerMode/TPS', (body: string) => {
            tpsPutBody = String(body);
            return true;
          })
          .reply(200, okXmlResponse);

        nock('http://hikvision.test:80')
          .get('/ISAPI/ITC/plateRecognitionParam')
          .reply(200, platePayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/ITC/plateRecognitionParam', (body: string) => {
            platePutBody = String(body);
            return true;
          })
          .reply(200, okXmlResponse);

        nock('http://hikvision.test:80')
          .get('/ISAPI/ITC/carFeatureParam')
          .reply(200, carFeaturePayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/ITC/carFeatureParam', (body: string) => {
            carFeaturePutBody = String(body);
            return true;
          })
          .reply(200, okXmlResponse);

        nock('http://hikvision.test:80')
          .get('/ISAPI/ITC/Snapshot/channels/1/capResInfo')
          .reply(200, capResPayload);

        nock('http://hikvision.test:80')
          .put('/ISAPI/ITC/Snapshot/channels/1/capResInfo', (body: string) => {
            capResPutBody = String(body);
            return true;
          })
          .reply(200, okXmlResponse);

        nock('http://hikvision.test:80')
          .get('/ISAPI/ITC/illegalSchedules')
          .query({ format: 'json' })
          .reply(200, {
            IllegalScheduleList: [
              {
                Schedule: {
                  eventType: 'post',
                  TimeBlockList: []
                }
              },
              {
                Schedule: {
                  eventType: 'overSpeed',
                  TimeBlockList: []
                }
              }
            ]
          });

        nock('http://hikvision.test:80')
          .put('/ISAPI/ITC/illegalSchedules', (body: unknown) => {
            schedulePutBody = body;
            return true;
          })
          .query({ format: 'json' })
          .reply(200, {
            statusCode: 1,
            subStatusCode: 'ok'
          });

        nock('http://hikvision.test:80')
          .put('/ISAPI/Event/notification/httpHosts', (body: string) => {
            webhookBodies.push(String(body));
            return true;
          })
          .times(2)
          .reply(200, okXmlResponse);

        nock('http://hikvision.test:80')
          .get('/ISAPI/Intelligent/channels/1/mixedTargetDetection')
          .query({ format: 'json' })
          .reply(200, {
            MixedTargetDetection: {
              isSupportBinaryPicUp: false,
              convertBinToBmpEnabled: false
            }
          });

        nock('http://hikvision.test:80')
          .put('/ISAPI/Intelligent/channels/1/mixedTargetDetection', (body: unknown) => {
            mixedTargetPutBody = body;
            return true;
          })
          .query({ format: 'json' })
          .reply(200, {
            statusCode: 1,
            subStatusCode: 'ok'
          });

        const device = new HikvisionDevice(defaultConfig);

        await device.setLPRConfiguration({
          uploadData: {
            uploadRealTimeData: true,
            uploadStatisticsData: true,
            uploadPositionData: true
          },
          captureSettings: {
            countryIndex: 76
          },
          vehicleDetectionFeatures: {
            safetyBeltDetection: false,
            phoneCallDetection: false,
            helmetDetection: false
          },
          imageQualitySettings: {
            resolution: {
              width: 2688,
              height: 1520
            }
          },
          schedules: [
            {
              eventType: 'post',
              schedule: {
                monday: { start: '01:00:00', end: '02:00:00' },
                tuesday: { start: '03:00:00', end: '04:00:00' },
                wednesday: { start: '05:00:00', end: '06:00:00' },
                thursday: { start: '07:00:00', end: '08:00:00' },
                friday: { start: '09:00:00', end: '10:00:00' },
                saturday: { start: '11:00:00', end: '12:00:00' },
                sunday: { start: '13:00:00', end: '14:00:00' },
              }
            }
          ],
          webhookNotification: [
            {
              id: 1,
              protocol: 'http',
              host: 'lpr-v2.sentinelx.com.br',
              path: '/hik_pro_connect',
              port: 80
            },
            {
              id: 2,
              protocol: 'https',
              host: 'hooks.test',
              path: '/lpr',
              port: 443
            }
          ],
          imageUploadOptions: {
            uploadBinaryImage: true,
            convertBinaryToBitmap: true
          }
        });

        expect(tpsPutBody).to.include('<enRealtimeDataUpload>true</enRealtimeDataUpload>');
        expect(tpsPutBody).to.include('<enStatisticalDataUpload>true</enStatisticalDataUpload>');
        expect(tpsPutBody).to.include('<posEnable>true</posEnable>');

        expect(platePutBody).to.include('<countryIndex>76</countryIndex>');

        expect(carFeaturePutBody).to.include('<safetyBeltEnabled>false</safetyBeltEnabled>');
        expect(carFeaturePutBody).to.include('<callEnabled>false</callEnabled>');
        expect(carFeaturePutBody).to.include('<helmetEnabled>false</helmetEnabled>');

        expect(capResPutBody).to.include('<capResolutionWidth>2688</capResolutionWidth>');
        expect(capResPutBody).to.include('<capResolutionHeight>1520</capResolutionHeight>');

        const schedulePayload = typeof schedulePutBody === 'string'
          ? JSON.parse(schedulePutBody)
          : schedulePutBody;
        expect(schedulePayload.IllegalScheduleList[0].Schedule.TimeBlockList[0].TimeBlock.dayOfWeek).to.equal(1);
        expect(schedulePayload.IllegalScheduleList[0].Schedule.TimeBlockList[0].TimeBlock.TimeRangeList[0].TimeRange.beginTime).to.equal('01:00:00');
        expect(schedulePayload.IllegalScheduleList[0].Schedule.TimeBlockList[0].TimeBlock.TimeRangeList[0].TimeRange.endTime).to.equal('02:00:00');

        expect(webhookBodies).to.have.length(2);
        expect(webhookBodies[0]).to.include('<id>1</id>');
        expect(webhookBodies[0]).to.include('<protocolType>HTTP</protocolType>');
        expect(webhookBodies[0]).to.include('<hostName>lpr-v2.sentinelx.com.br</hostName>');
        expect(webhookBodies[0]).to.include('<detectionUpLoadPicturesType>all</detectionUpLoadPicturesType>');
        expect(webhookBodies[1]).to.include('<id>2</id>');
        expect(webhookBodies[1]).to.include('<protocolType>HTTPS</protocolType>');

        const mixedPayload = typeof mixedTargetPutBody === 'string'
          ? JSON.parse(mixedTargetPutBody)
          : mixedTargetPutBody;
        expect(mixedPayload.MixedTargetDetection.isSupportBinaryPicUp).to.equal('true');
        expect(mixedPayload.MixedTargetDetection.convertBinToBmpEnabled).to.equal(true);
      });

      it('does not send lpr capture settings update when country index is unchanged', async () => {
        const platePayload = `<?xml version="1.0" encoding="UTF-8"?>
        <PlateRecognitionParam>
          <countryIndex>220</countryIndex>
        </PlateRecognitionParam>`;

        nock('http://hikvision.test:80')
          .get('/ISAPI/ITC/plateRecognitionParam')
          .reply(200, platePayload);

        const device = new HikvisionDevice(defaultConfig);

        await device.setLPRConfiguration({
          captureSettings: {
            countryIndex: 220
          }
        });
      });

      it('throws MissingConfigurationError when lpr schedule event type is not found', async () => {
        nock('http://hikvision.test:80')
          .get('/ISAPI/ITC/illegalSchedules')
          .query({ format: 'json' })
          .reply(200, {
            IllegalScheduleList: [
              {
                Schedule: {
                  eventType: 'post',
                  TimeBlockList: []
                }
              }
            ]
          });

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setLPRConfiguration({
            schedules: [
              {
                eventType: 'overSpeed',
                schedule: {
                  monday: { start: '00:00:00', end: '24:00:00' },
                  tuesday: { start: '00:00:00', end: '24:00:00' },
                  wednesday: { start: '00:00:00', end: '24:00:00' },
                  thursday: { start: '00:00:00', end: '24:00:00' },
                  friday: { start: '00:00:00', end: '24:00:00' },
                  saturday: { start: '00:00:00', end: '24:00:00' },
                  sunday: { start: '00:00:00', end: '24:00:00' },
                }
              }
            ]
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(MissingConfigurationError);
        }
      });

      it('throws HttpRequestError when lpr upload data request fails', async () => {
        nock('http://hikvision.test:80')
          .get('/ISAPI/ITC/TriggerMode/TPS')
          .reply(500, 'error');

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setLPRConfiguration({
            uploadData: {
              uploadRealTimeData: true,
              uploadStatisticsData: true,
              uploadPositionData: true
            }
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('throws HttpRequestError when lpr mixed target update response is invalid', async () => {
        nock('http://hikvision.test:80')
          .get('/ISAPI/Intelligent/channels/1/mixedTargetDetection')
          .query({ format: 'json' })
          .reply(200, {
            MixedTargetDetection: {
              isSupportBinaryPicUp: false,
              convertBinToBmpEnabled: false
            }
          });

        nock('http://hikvision.test:80')
          .put('/ISAPI/Intelligent/channels/1/mixedTargetDetection')
          .query({ format: 'json' })
          .reply(200, {
            statusCode: 2,
            subStatusCode: 'error'
          });

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setLPRConfiguration({
            imageUploadOptions: {
              uploadBinaryImage: true,
              convertBinaryToBitmap: true
            }
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it('reboots camera when response is ok', async () => {
        const rebootPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
        <statusCode>1</statusCode>
        <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        nock('http://hikvision.test:80')
          .put('/ISAPI/System/reboot')
          .reply(200, rebootPayload);

        const device = new HikvisionDevice(defaultConfig);

        await device.reboot();
      });

      it('throws HttpRequestError when reboot response is invalid', async () => {
        const rebootPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
        <statusCode>2</statusCode>
        <subStatusCode>error</subStatusCode>
        </ResponseStatus>`;

        nock('http://hikvision.test:80')
          .put('/ISAPI/System/reboot')
          .reply(200, rebootPayload);

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.reboot();
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });
});
