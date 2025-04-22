// jest.mock('fs');
// jest.mock('../utils/common', () => ({
//   retryAwaitableAsync: jest.fn(),
// }));
// jest.mock('./Logger', () => ({
//   Logger: { getInstance: () => ({ log: jest.fn(), error: jest.fn() }) },
// }));
// jest.mock('./ErrorHandler', () => ({
//   ErrorHandler: { getInstance: () => ({ handleError: jest.fn() }) },
// }));
// jest.mock('./Queue', () => {
//   return {
//     Queue: jest.fn().mockImplementation(() => ({
//       enqueue: jest.fn(),
//     })),
//   };
// });

// import fs from 'fs';

// import { SwarmStreamUploader } from './SwarmStreamUploader';

// describe('SwarmStreamUploader', () => {
//   const mockParams = {
//     manifestBeeUrl: 'http://my.bee.node',
//     gsocKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
//     gsocTopic: 'topic-1',
//     stamp: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
//     streamPath: '/mock/stream',
//   };

//   const mockBee = {
//     uploadData: jest.fn().mockResolvedValue({ reference: { toHex: () => 'mockRef' } }),
//     gsocSend: jest.fn().mockResolvedValue({ reference: { toHex: () => 'gsocRef' } }),
//   };

//   const createUploader = () =>
//     new SwarmStreamUploader(
//       mockBee as any,
//       mockParams.manifestBeeUrl,
//       mockParams.gsocKey,
//       mockParams.gsocTopic,
//       mockParams.stamp,
//       mockParams.streamPath,
//     );

//   beforeEach(() => {
//     jest.clearAllMocks();
//     (fs.readFileSync as jest.Mock).mockReset();
//     (fs.writeFileSync as jest.Mock).mockReset();
//     (fs.rmSync as jest.Mock).mockReset();
//   });

//   it('should enqueue a segment upload', () => {
//     const uploader = createUploader();
//     uploader['queue'].enqueue = jest.fn();

//     uploader.enqueueNewSegment('/mock/stream/seg.ts');
//     expect(uploader['queue'].enqueue).toHaveBeenCalledWith(expect.any(Function));
//   });

//   it('should skip uploading .m3u8 files', async () => {
//     const uploader = createUploader();
//     const spy = jest.spyOn(uploader as any, 'uploadSegment');
//     await (uploader as any).upload('/mock/stream/index.m3u8');

//     expect(spy).not.toHaveBeenCalled();
//   });

//   it('should call uploadSegment and update manifest', async () => {
//     const uploader = createUploader();

//     jest.spyOn(uploader as any, 'uploadSegment').mockResolvedValue('mockRef');
//     jest.spyOn(uploader as any, 'getExtInfFromFile').mockReturnValue(5.2);
//     jest.spyOn(uploader as any, 'uploadManifest').mockResolvedValue(undefined);
//     jest.spyOn(uploader as any, 'rmProcessedSegment').mockImplementation(() => {});

//     await (uploader as any).upload('/mock/stream/seg.ts');

//     expect(fs.writeFileSync).toHaveBeenCalledWith(
//       expect.stringContaining('playlist.m3u8'),
//       expect.stringContaining('#EXT-X-MEDIA-SEQUENCE:0'),
//     );
//   });

//   it('should increase media sequence and shift buffer', async () => {
//     const uploader = createUploader();

//     jest.spyOn(uploader as any, 'uploadSegment').mockResolvedValue('mockRef');
//     jest.spyOn(uploader as any, 'getExtInfFromFile').mockReturnValue(6.0);
//     jest.spyOn(uploader as any, 'uploadManifest').mockResolvedValue(undefined);
//     jest.spyOn(uploader as any, 'rmProcessedSegment').mockImplementation(() => {});

//     for (let i = 0; i < 22; i++) {
//       await (uploader as any).upload(`/mock/stream/seg${i}.ts`);
//     }

//     expect(uploader['segmentBuffer'].length).toBeLessThanOrEqual(20);
//     expect(uploader['mediaSequence']).toBe(2); // 2 segments trimmed off
//   });

//   it('should log error if uploadSegment fails', async () => {
//     const uploader = createUploader();

//     jest.spyOn(uploader as any, 'uploadSegment').mockResolvedValue(undefined);
//     const loggerError = jest.spyOn((uploader as any).logger, 'error');

//     await (uploader as any).upload('/mock/stream/seg.ts');

//     expect(loggerError).toHaveBeenCalledWith(expect.stringMatching(/Failed to upload segment/));
//   });
// });
export const test = 'test';
