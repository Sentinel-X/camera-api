import { expect } from "chai";
import { after, afterEach, before, describe, it } from "mocha";
import nock from "nock";
import { HikvisionDevice } from "../../src/devices/hikvision/service.js";
import { HttpRequestError, MissingConfigurationError } from "../../src/errors.js";
import { DeviceConfiguration } from "../../src/types.js";

const defaultConfig: DeviceConfiguration = {
    ipOrHttpAddress: "http://hikvision.test",
    port: 80,
    username: "admin",
    password: "password"
};

describe("HikvisionDevice", () => {
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

    it("returns normalized coordinates from field detection XML", async () => {
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

        nock("http://hikvision.test:80")
            .get("/ISAPI/Smart/FieldDetection/1")
            .reply(200, payload);

        const device = new HikvisionDevice(defaultConfig);

        const coordinates = await device.getInvasionAreaCoordinates();

        expect(coordinates).to.deep.equal([
            { x: 0, y: 0 },
            { x: 1, y: 1 }
        ]);
    });

    it("throws MissingConfigurationError when field detection is disabled", async () => {
        const payload = `<?xml version="1.0" encoding="UTF-8"?>
      <FieldDetection>
        <enabled>false</enabled>
      </FieldDetection>`;

        nock("http://hikvision.test:80")
            .get("/ISAPI/Smart/FieldDetection/1")
            .reply(200, payload);

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.getInvasionAreaCoordinates();
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(MissingConfigurationError);
        }
    });

    it("updates region id=1 coordinates using converted camera values", async () => {
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

        let putBody = "";
        nock("http://hikvision.test:80")
            .get("/ISAPI/Smart/FieldDetection/1")
            .reply(200, getPayload);

        nock("http://hikvision.test:80")
            .put("/ISAPI/Smart/FieldDetection/1", (body: string) => {
                putBody = String(body);
                return true;
            })
            .reply(200, putPayload);

        const device = new HikvisionDevice(defaultConfig);

        await device.setInvasionAreaCoordinates([
            { x: 0.25, y: 0.75 },
            { x: 1, y: 0 }
        ]);

        expect(putBody).to.include("<positionX>250</positionX>");
        expect(putBody).to.include("<positionY>250</positionY>");
        expect(putBody).to.include("<positionX>1000</positionX>");
        expect(putBody).to.include("<positionY>1000</positionY>");
    });

    it("throws HttpRequestError when update response is not ok", async () => {
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

        nock("http://hikvision.test:80")
            .get("/ISAPI/Smart/FieldDetection/1")
            .reply(200, getPayload);

        nock("http://hikvision.test:80")
            .put("/ISAPI/Smart/FieldDetection/1")
            .reply(200, badPutPayload);

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.setInvasionAreaCoordinates([{ x: 0.1, y: 0.2 }]);
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it("updates image quality configuration and returns needsReboot when camera requires reboot", async () => {
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

        let putBody = "";

        nock("http://hikvision.test:80")
            .get("/ISAPI/Streaming/channels")
            .reply(200, channelsPayload);

        nock("http://hikvision.test:80")
            .get("/ISAPI/Streaming/channels/101")
            .reply(200, channelPayload);

        nock("http://hikvision.test:80")
            .put("/ISAPI/Streaming/channels/101", (body: string) => {
                putBody = String(body);
                return true;
            })
            .reply(200, rebootRequiredPayload);

        const device = new HikvisionDevice({
            ...defaultConfig,
            serialNumber: "SERIAL-123"
        });

        const result = await device.setImageQualityConfiguration({
            compression: "h265",
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
        expect(putBody).to.include("<channelName>SERIAL-123</channelName>");
        expect(putBody).to.include("<videoCodecType>H.265</videoCodecType>");
        expect(putBody).to.include("<H265Profile>Main</H265Profile>");
        expect(putBody).to.not.include("<H264Profile>");
        expect(putBody).to.include("<maxFrameRate>2000</maxFrameRate>");
        expect(putBody).to.include("<videoResolutionWidth>1920</videoResolutionWidth>");
        expect(putBody).to.include("<videoResolutionHeight>1080</videoResolutionHeight>");
        expect(putBody).to.include("<constantBitRate>2048</constantBitRate>");
        expect(putBody).to.include("<vbrUpperCap>2200</vbrUpperCap>");
        expect(putBody).to.include("<vbrAverageCap>1100</vbrAverageCap>");
    });

    it("returns needsReboot=false when no channel update is required", async () => {
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

        nock("http://hikvision.test:80")
            .get("/ISAPI/Streaming/channels")
            .reply(200, channelsPayload);

        nock("http://hikvision.test:80")
            .get("/ISAPI/Streaming/channels/101")
            .reply(200, channelPayload);

        const device = new HikvisionDevice(defaultConfig);

        const result = await device.setImageQualityConfiguration({
            compression: "h265",
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

    it("skips smart codec update when enabled value is already set to requested value", async () => {
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

        nock("http://hikvision.test:80")
            .get("/ISAPI/Streaming/channels")
            .reply(200, channelsPayload);

        nock("http://hikvision.test:80")
            .get("/ISAPI/Streaming/channels/101")
            .reply(200, channelPayload);

        const device = new HikvisionDevice(defaultConfig);

        // smartCodec is already true, so no PUT should be sent
        const result = await device.setImageQualityConfiguration({
            smartCodec: true
        });

        expect(result).to.deep.equal({ needsReboot: false });
    });

    it("sends smart codec update when enabled value differs from requested value", async () => {
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

        let putBody = "";

        nock("http://hikvision.test:80")
            .get("/ISAPI/Streaming/channels")
            .reply(200, channelsPayload);

        nock("http://hikvision.test:80")
            .get("/ISAPI/Streaming/channels/101")
            .reply(200, channelPayload);

        nock("http://hikvision.test:80")
            .put("/ISAPI/Streaming/channels/101", (body: string) => {
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
        expect(putBody).to.include("<enabled>true</enabled>");
    });

    it("throws HttpRequestError when channel update response is invalid", async () => {
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

        nock("http://hikvision.test:80")
            .get("/ISAPI/Streaming/channels")
            .reply(200, channelsPayload);

        nock("http://hikvision.test:80")
            .get("/ISAPI/Streaming/channels/101")
            .reply(200, channelPayload);

        nock("http://hikvision.test:80")
            .put("/ISAPI/Streaming/channels/101")
            .reply(200, invalidUpdatePayload);

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.setImageQualityConfiguration({
                compression: "h265",
                fps: 20
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it("updates recording schedule configuration using day start/end and record flags", async () => {
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

        let putBody = "";

        nock("http://hikvision.test:80")
            .get("/ISAPI/ContentMgmt/record/tracks")
            .reply(200, getPayload);

        nock("http://hikvision.test:80")
            .put("/ISAPI/ContentMgmt/record/tracks", (body: string) => {
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
                    monday: { start: "01:00:00", end: "02:00:00", record: true },
                    tuesday: { start: "03:00:00", end: "04:00:00", record: false },
                    wednesday: { start: "05:00:00", end: "06:00:00", record: true },
                    thursday: { start: "07:00:00", end: "08:00:00", record: false },
                    friday: { start: "09:00:00", end: "10:00:00", record: true },
                    saturday: { start: "11:00:00", end: "12:00:00", record: false },
                    sunday: { start: "13:00:00", end: "23:59:59", record: true },
                }
            }
        ]);

        expect(putBody).to.include("<Enable>true</Enable>");
        expect(putBody).to.include("<LoopEnable>false</LoopEnable>");
        expect(putBody).to.include("<enableSchedule>true</enableSchedule>");

        expect(putBody).to.include("<DayOfWeek>Monday</DayOfWeek>");
        expect(putBody).to.include("<TimeOfDay>01:00:00</TimeOfDay>");
        expect(putBody).to.include("<TimeOfDay>02:00:00</TimeOfDay>");
        expect(putBody).to.include("<DayOfWeek>Tuesday</DayOfWeek>");
        expect(putBody).to.include("<TimeOfDay>03:00:00</TimeOfDay>");
        expect(putBody).to.include("<TimeOfDay>04:00:00</TimeOfDay>");
        expect(putBody).to.include("<DayOfWeek>Sunday</DayOfWeek>");
        expect(putBody).to.include("<TimeOfDay>13:00:00</TimeOfDay>");
        expect(putBody).to.include("<TimeOfDay>23:59:59</TimeOfDay>");
        expect((putBody.match(/<ScheduleAction>/g) || []).length).to.equal(7);

        expect(putBody).to.include("<Record>true</Record>");
        expect(putBody).to.include("<Record>false</Record>");
    });

    it("does not send schedule update when no configuration matches any track", async () => {
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

        nock("http://hikvision.test:80")
            .get("/ISAPI/ContentMgmt/record/tracks")
            .reply(200, getPayload);

        const device = new HikvisionDevice(defaultConfig);

        await device.setRecordingScheduleConfiguration([
            {
                channelId: 2,
                enabled: true,
                overwriteOldestRecords: false,
                schedule: {
                    monday: { start: "01:00:00", end: "02:00:00", record: true },
                    tuesday: { start: "01:00:00", end: "02:00:00", record: true },
                    wednesday: { start: "01:00:00", end: "02:00:00", record: true },
                    thursday: { start: "01:00:00", end: "02:00:00", record: true },
                    friday: { start: "01:00:00", end: "02:00:00", record: true },
                    saturday: { start: "01:00:00", end: "02:00:00", record: true },
                    sunday: { start: "01:00:00", end: "02:00:00", record: true },
                }
            }
        ]);
    });

    it("throws MissingConfigurationError when schedule block is missing", async () => {
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

        nock("http://hikvision.test:80")
            .get("/ISAPI/ContentMgmt/record/tracks")
            .reply(200, getPayload);

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.setRecordingScheduleConfiguration([
                {
                    channelId: 1,
                    enabled: true,
                    overwriteOldestRecords: false,
                    schedule: {
                        monday: { start: "01:00:00", end: "02:00:00", record: true },
                        tuesday: { start: "01:00:00", end: "02:00:00", record: true },
                        wednesday: { start: "01:00:00", end: "02:00:00", record: true },
                        thursday: { start: "01:00:00", end: "02:00:00", record: true },
                        friday: { start: "01:00:00", end: "02:00:00", record: true },
                        saturday: { start: "01:00:00", end: "02:00:00", record: true },
                        sunday: { start: "01:00:00", end: "02:00:00", record: true },
                    }
                }
            ]);
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(MissingConfigurationError);
        }
    });

    it("throws HttpRequestError when recording schedule update response is invalid", async () => {
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

        nock("http://hikvision.test:80")
            .get("/ISAPI/ContentMgmt/record/tracks")
            .reply(200, getPayload);

        nock("http://hikvision.test:80")
            .put("/ISAPI/ContentMgmt/record/tracks")
            .reply(200, invalidPutResponse);

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.setRecordingScheduleConfiguration([
                {
                    channelId: 1,
                    enabled: true,
                    overwriteOldestRecords: false,
                    schedule: {
                        monday: { start: "01:00:00", end: "02:00:00", record: true },
                        tuesday: { start: "01:00:00", end: "02:00:00", record: true },
                        wednesday: { start: "01:00:00", end: "02:00:00", record: true },
                        thursday: { start: "01:00:00", end: "02:00:00", record: true },
                        friday: { start: "01:00:00", end: "02:00:00", record: true },
                        saturday: { start: "01:00:00", end: "02:00:00", record: true },
                        sunday: { start: "01:00:00", end: "02:00:00", record: true },
                    }
                }
            ]);
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

      it("returns parsed HDD list from camera payload", async () => {
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

        nock("http://hikvision.test:80")
          .get("/ISAPI/ContentMgmt/Storage/hdd")
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

      it("throws HttpRequestError when getHddList request fails", async () => {
        nock("http://hikvision.test:80")
          .get("/ISAPI/ContentMgmt/Storage/hdd")
          .reply(500, "error");

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.getHddList();
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it("updates storage quota when quota ratios differ", async () => {
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

        let putBody = "";

        nock("http://hikvision.test:80")
          .get("/ISAPI/ContentMgmt/Storage/quota/1")
          .reply(200, getPayload);

        nock("http://hikvision.test:80")
          .put("/ISAPI/ContentMgmt/Storage/quota/1", (body: string) => {
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

        expect(putBody).to.include("<videoQuotaRatio>90</videoQuotaRatio>");
        expect(putBody).to.include("<pictureQuotaRatio>10</pictureQuotaRatio>");
      });

      it("does not send storage quota update when ratios are unchanged", async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <diskQuota version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
          <id>1</id>
          <type>ratio</type>
          <videoQuotaRatio>95</videoQuotaRatio>
          <pictureQuotaRatio>5</pictureQuotaRatio>
        </diskQuota>`;

        nock("http://hikvision.test:80")
          .get("/ISAPI/ContentMgmt/Storage/quota/1")
          .reply(200, getPayload);

        const device = new HikvisionDevice(defaultConfig);

        await device.setStorageQuota({
          hddId: 1,
          videoQuotaRatio: 95,
          pictureQuotaRatio: 5,
        });
      });

      it("throws HttpRequestError when setStorageQuota get request fails", async () => {
        nock("http://hikvision.test:80")
          .get("/ISAPI/ContentMgmt/Storage/quota")
          .reply(500, "error");

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

      it("throws HttpRequestError when setStorageQuota update request fails", async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <diskQuota version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
          <id>1</id>
          <type>ratio</type>
          <videoQuotaRatio>95</videoQuotaRatio>
          <pictureQuotaRatio>5</pictureQuotaRatio>
        </diskQuota>`;

        nock("http://hikvision.test:80")
          .get("/ISAPI/ContentMgmt/Storage/quota/1")
          .reply(200, getPayload);

        nock("http://hikvision.test:80")
          .put("/ISAPI/ContentMgmt/Storage/quota/1")
          .reply(500, "error");

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

      it("throws HttpRequestError when setStorageQuota update response is invalid", async () => {
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

        nock("http://hikvision.test:80")
          .get("/ISAPI/ContentMgmt/Storage/quota/1")
          .reply(200, getPayload);

        nock("http://hikvision.test:80")
          .put("/ISAPI/ContentMgmt/Storage/quota/1")
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

    it("updates time configuration in manual mode", async () => {
        let timeBody = "";

        nock("http://hikvision.test:80")
            .put("/ISAPI/System/time", (body: string) => {
                timeBody = String(body);
                return true;
            })
            .reply(200, "");

        const device = new HikvisionDevice(defaultConfig);

        await device.setTimeConfiguration({
            ntp: {
                enabled: false
            },
            timezone: "GMT-03:00"
        });

        expect(timeBody).to.include("<timeMode>manual</timeMode>");
        expect(timeBody).to.include("<timeZone>GMT-03:00</timeZone>");
        expect(timeBody).to.match(/<localTime>.+<\/localTime>/);
    });

    it("updates time configuration in ntp mode", async () => {
        let timeBody = "";
        let ntpBody = "";

        nock("http://hikvision.test:80")
            .put("/ISAPI/System/time", (body: string) => {
                timeBody = String(body);
                return true;
            })
            .reply(200, "");

        nock("http://hikvision.test:80")
            .put("/ISAPI/System/time/ntpServers/1", (body: string) => {
                ntpBody = String(body);
                return true;
            })
            .reply(200, "");

        const device = new HikvisionDevice(defaultConfig);

        await device.setTimeConfiguration({
            ntp: {
                enabled: true,
                server: "time.google.com",
                port: 123,
                interval: 60
            },
            timezone: "GMT-03:00"
        });

        expect(timeBody).to.include("<timeMode>NTP</timeMode>");
        expect(timeBody).to.include("<timeZone>GMT-03:00</timeZone>");
        expect(timeBody).to.not.include("<localTime>");

        expect(ntpBody).to.include("<NTPServer>");
        expect(ntpBody).to.include("<id>1</id>");
        expect(ntpBody).to.include("<addressingFormatType>hostname</addressingFormatType>");
        expect(ntpBody).to.include("<hostName>time.google.com</hostName>");
        expect(ntpBody).to.include("<portNo>123</portNo>");
        expect(ntpBody).to.include("<synchronizeInterval>60</synchronizeInterval>");
    });

    it("throws HttpRequestError when time update request fails", async () => {
        nock("http://hikvision.test:80")
            .put("/ISAPI/System/time")
            .reply(500, "error");

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.setTimeConfiguration({
                ntp: {
                    enabled: false
                },
                timezone: "GMT-03:00"
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it("throws HttpRequestError when ntp update request fails", async () => {
        nock("http://hikvision.test:80")
            .put("/ISAPI/System/time")
            .reply(200, "");

        nock("http://hikvision.test:80")
            .put("/ISAPI/System/time/ntpServers/1")
            .reply(500, "error");

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.setTimeConfiguration({
                ntp: {
                    enabled: true,
                    server: "time.google.com",
                    port: 123,
                    interval: 60
                },
                timezone: "GMT-03:00"
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it("returns current time from camera xml", async () => {
        const timePayload = `<?xml version="1.0" encoding="UTF-8"?>
        <Time>
        <timeMode>manual</timeMode>
        <localTime>2026-04-16T02:28:28-03:00</localTime>
        <timeZone>CST+3:00:00</timeZone>
        </Time>`;

        nock("http://hikvision.test:80")
            .get("/ISAPI/System/time")
            .reply(200, timePayload);

        const device = new HikvisionDevice(defaultConfig);

        const currentTime = await device.getCurrentTime();

        expect(currentTime.toISOString()).to.equal("2026-04-16T05:28:28.000Z");
    });

    it("throws HttpRequestError when getCurrentTime request fails", async () => {
        nock("http://hikvision.test:80")
            .get("/ISAPI/System/time")
            .reply(500, "error");

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.getCurrentTime();
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it("throws HttpRequestError when camera returns invalid current time", async () => {
        const timePayload = `<?xml version="1.0" encoding="UTF-8"?>
        <Time>
        <timeMode>manual</timeMode>
        <localTime>not-a-date</localTime>
        <timeZone>CST+3:00:00</timeZone>
        </Time>`;

        nock("http://hikvision.test:80")
            .get("/ISAPI/System/time")
            .reply(200, timePayload);

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.getCurrentTime();
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it("sets current time preserving camera time configuration fields", async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <Time>
        <timeMode>manual</timeMode>
        <localTime>2026-04-16T02:28:28-03:00</localTime>
        <timeZone>GMT-03:00</timeZone>
        </Time>`;

        let putBody = "";

        nock("http://hikvision.test:80")
            .get("/ISAPI/System/time")
            .reply(200, getPayload);

        nock("http://hikvision.test:80")
            .put("/ISAPI/System/time", (body: string) => {
                putBody = String(body);
                return true;
            })
            .reply(200, "");

        const device = new HikvisionDevice(defaultConfig);

        await device.setCurrentTime(new Date("2026-04-16T05:30:35.000Z"));

        expect(putBody).to.include("<timeMode>manual</timeMode>");
        expect(putBody).to.include("<timeZone>GMT-03:00</timeZone>");
        expect(putBody).to.match(/<localTime>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})<\/localTime>/);
        expect(putBody).to.not.include("<localTime>2026-04-16T02:28:28-03:00</localTime>");
    });

    it("throws HttpRequestError when setCurrentTime cannot read current configuration", async () => {
        nock("http://hikvision.test:80")
            .get("/ISAPI/System/time")
            .reply(500, "error");

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.setCurrentTime(new Date("2026-04-16T05:30:35.000Z"));
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it("throws HttpRequestError when setCurrentTime update request fails", async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <Time>
        <timeMode>manual</timeMode>
        <localTime>2026-04-16T02:28:28-03:00</localTime>
        <timeZone>GMT-03:00</timeZone>
        </Time>`;

        nock("http://hikvision.test:80")
            .get("/ISAPI/System/time")
            .reply(200, getPayload);

        nock("http://hikvision.test:80")
            .put("/ISAPI/System/time")
            .reply(500, "error");

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.setCurrentTime(new Date("2026-04-16T05:30:35.000Z"));
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

      it("returns overlay configuration from camera xml", async () => {
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

        nock("http://hikvision.test:80")
          .get("/ISAPI/System/Video/inputs/channels/1/overlays")
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
              text: "SMART SAMPA",
              positionX: 0,
              positionY: 480,
            }
          ],
          dateTimeOverlay: {
            enabled: true,
            positionX: 550,
            positionY: 480,
            dateFormat: "DD-MM-YYYY",
            timeFormat: "24hour",
            displayWeek: false,
          },
          channelNameOverlay: {
            enabled: false,
          },
          style: {
            fontSize: "32*32",
            alignment: "customize",
          }
        });
      });

      it("throws HttpRequestError when getOverlayConfiguration request fails", async () => {
        nock("http://hikvision.test:80")
          .get("/ISAPI/System/Video/inputs/channels/1/overlays")
          .reply(500, "error");

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.getOverlayConfiguration(1);
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it("updates overlay configuration using current camera payload", async () => {
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

        let putBody = "";

        nock("http://hikvision.test:80")
          .get("/ISAPI/System/Video/inputs/channels/1/overlays")
          .reply(200, getPayload);

        nock("http://hikvision.test:80")
          .put("/ISAPI/System/Video/inputs/channels/1/overlays", (body: string) => {
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
              text: "SMART SAMPA",
              positionX: 10,
              positionY: 20,
            },
            {
              enabled: false,
              text: "SECOND",
              positionX: 30,
              positionY: 40,
            }
          ],
          dateTimeOverlay: {
            enabled: false,
            positionX: 123,
            positionY: 321,
            dateFormat: "YYYY-MM-DD",
            timeFormat: "12hour",
            displayWeek: true,
          },
          channelNameOverlay: {
            enabled: true,
          },
          style: {
            fontSize: "16*16",
            alignment: "alignLeft",
          }
        });

        expect(putBody).to.include("<TextOverlayList size=\"2\">");
        expect(putBody).to.include("<id>1</id>");
        expect(putBody).to.include("<id>2</id>");
        expect(putBody).to.include("<displayText>SMART SAMPA</displayText>");
        expect(putBody).to.include("<displayText>SECOND</displayText>");
        expect(putBody).to.include("<dateStyle>YYYY-MM-DD</dateStyle>");
        expect(putBody).to.include("<timeStyle>12hour</timeStyle>");
        expect(putBody).to.include("<displayWeek>true</displayWeek>");
        expect(putBody).to.include("<fontSize>16*16</fontSize>");
        expect(putBody).to.include("<alignment>alignLeft</alignment>");
      });

      it("throws HttpRequestError when setOverlayConfiguration response is invalid", async () => {
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

        nock("http://hikvision.test:80")
          .get("/ISAPI/System/Video/inputs/channels/1/overlays")
          .reply(200, getPayload);

        nock("http://hikvision.test:80")
          .put("/ISAPI/System/Video/inputs/channels/1/overlays")
          .reply(200, invalidPutResponse);

        const device = new HikvisionDevice(defaultConfig);

        try {
          await device.setOverlayConfiguration(1, {
            style: {
              fontSize: "32*32",
              alignment: "customize",
            }
          });
          expect.fail('Function should have thrown');
        } catch (error) {
          expect(error).to.be.instanceOf(HttpRequestError);
        }
      });

      it("reboots camera when response is ok", async () => {
        const rebootPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
        <statusCode>1</statusCode>
        <subStatusCode>ok</subStatusCode>
        </ResponseStatus>`;

        nock("http://hikvision.test:80")
          .put("/ISAPI/System/reboot")
          .reply(200, rebootPayload);

        const device = new HikvisionDevice(defaultConfig);

        await device.reboot();
      });

      it("throws HttpRequestError when reboot response is invalid", async () => {
        const rebootPayload = `<?xml version="1.0" encoding="UTF-8"?>
        <ResponseStatus>
        <statusCode>2</statusCode>
        <subStatusCode>error</subStatusCode>
        </ResponseStatus>`;

        nock("http://hikvision.test:80")
          .put("/ISAPI/System/reboot")
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
