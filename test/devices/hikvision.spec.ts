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
});
