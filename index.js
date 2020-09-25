const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
// const ffmpeg = require('fluent-ffmpeg');
var spawn = require('child_process').spawn;
const fs = require('fs');
const util = require('util');
const exec = require('child_process').exec;
const execSync = util.promisify(exec);

// ffmpeg.setFfmpegPath(ffmpegPath);

let masterManifest6sec = "#EXTM3U\n";
let masterManifest5sec = "#EXTM3U\n";


const renditions = [
    { name: "1080p_60", resolution_width: 1920, resolution_height: 1080, bitrate: 6000, audio_bitrate: 192, frame_rate: 60 },
    { name: "1080p", resolution_width: 1920, resolution_height: 1080, bitrate: 5000, audio_bitrate: 192, frame_rate: 24 },
    { name: "720p", resolution_width: 1280, resolution_height: 720, bitrate: 3200, audio_bitrate: 128, frame_rate: 24 },
    { name: "480p", resolution_width: 854, resolution_height: 480, bitrate: 1600, audio_bitrate: 128, frame_rate: 24 },
    { name: "360p", resolution_width: 640, resolution_height: 360, bitrate: 1100, audio_bitrate: 128, frame_rate: 24 }

];

const max_bitrate_ratio = 1.07 // maximum accepted bitrate fluctuations
const rate_monitor_buffer_ratio = 1.5 // maximum buffer size between bitrate conformance checks


async function prepareEnvironment(renditionsArray) {
    console.log("Preparing transcoding environment");

    console.log("Installing ffmpeg binary");

    try {
        await execSync(`npm install`);
    } catch (e) {
        console.log("Error: ", e);
        return;
    }

    console.log("Installation complete");


    let directories = ["hls_assets", "hls_assets/segment_6", "hls_assets/segment_5", "./hls_assets/segment_5/audio/"];

    for (let rendition of renditionsArray) {

        directories = [...directories, `./hls_assets/segment_6/${rendition.name}/`, `./hls_assets/segment_5/${rendition.name}/`]

    }

    for (let dir of directories) {
        if (!fs.existsSync(dir)) {
            console.log(`Creating ${dir}`);
            fs.mkdirSync(dir);
            console.log(`Created ${dir}`);

        }

    }

}


function prepare6secSegmentsCMD(inputFilePath, renditionsArray, audioCodec, videoCodec, maxKeyFrame, minKeyFrame) {

    let durationString = "segment_6";
    let assetFolder = "hls_assets";

    let cmd = `${ffmpegPath} -i ${inputFilePath} -hide_banner -y -loglevel quiet -stats `;

    for (let rendition of renditionsArray) {

        let renditionDir = `./${assetFolder}/${durationString}/${rendition.name}`;

        cmd +=
            `-vf scale=w=${rendition.resolution_width}:h=${rendition.resolution_height}\
     -c:a ${audioCodec} -ar 48000 -c:v ${videoCodec} -profile:v main -crf 20 -sc_threshold 0 -g ${rendition.frame_rate*6}\
      -keyint_min ${rendition.frame_rate*6} -hls_time 6 -hls_playlist_type vod  -b:v ${rendition.bitrate}k \
      -maxrate ${rendition.bitrate*max_bitrate_ratio}k -bufsize ${rendition.bitrate*rate_monitor_buffer_ratio}k \
      -b:a ${rendition.audio_bitrate}k -r ${rendition.frame_rate}\
      -hls_segment_filename ${renditionDir}/${rendition.name}_%03d.ts ${renditionDir}/${rendition.name}.m3u8 `;


        masterManifest6sec += `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bitrate*1000},AVERAGE-BANDWIDTH=${rendition.bitrate*1000},RESOLUTION=${rendition.resolution_width}X${rendition.resolution_height},CODECS="aac,h264",FRAME-RATE=${rendition.frame_rate}\n${durationString}/${rendition.name}/${rendition.name}.m3u8\n`;
    }

    return cmd;

}



function prepare5secSegmentsCMD(inputFilePath, renditionsArray, audioCodec, videoCodec, minKeyFrame) {

    let durationString = "segment_5";
    let assetFolder = "hls_assets";

    let cmd = `${ffmpegPath} -i ${inputFilePath} -hide_banner -y -loglevel quiet -stats `;

    for (let rendition of renditionsArray) {
        let renditionDir = `./${assetFolder}/${durationString}/${rendition.name}`;

        cmd +=
            `-vf scale=w=${rendition.resolution_width}:h=${rendition.resolution_height}\
 -c:a ${audioCodec} -ar 48000 -c:v ${videoCodec} -profile:v main -crf 20 -sc_threshold 0 \
  -keyint_min ${rendition.frame_rate*5} -hls_time 5 -hls_playlist_type vod  -b:v ${rendition.bitrate}k \
  -maxrate ${rendition.bitrate*max_bitrate_ratio}k -bufsize ${rendition.bitrate*rate_monitor_buffer_ratio}k \
  -b:a ${rendition.audio_bitrate}k -r ${rendition.frame_rate}\
  -hls_segment_filename ${renditionDir}/${rendition.name}_%03d.ts ${renditionDir}/${rendition.name}.m3u8 `;

        masterManifest5sec += `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bitrate*1000},AVERAGE-BANDWIDTH=${rendition.bitrate*1000},RESOLUTION=${rendition.resolution_width}X${rendition.resolution_height},CODECS="aac,h264",FRAME-RATE=${rendition.frame_rate}\n${durationString}/${rendition.name}/${rendition.name}.m3u8\n`;

    }

    cmd +=
        `-c:a ${audioCodec} -ar 48000 -vn -hls_time 5 -hls_playlist_type vod -b:a 192k\
     -hls_segment_filename ./${assetFolder}/${durationString}/audio/audio_%03d.ts ./${assetFolder}/${durationString}/audio/audio.m3u8 `;

    masterManifest5sec += `#EXT-X-STREAM-INF:BANDWIDTH=192000,AVERAGE-BANDWIDTH=192000,CODECS="aac"\n${durationString}/audio/audio.m3u8\n`;

    return cmd;

}


async function run() {



    var cmd_6sec = "";
    var cmd_5sec = "";
    let inputFilePath = "";

    if (process.argv.length < 3) {
        console.log("No input file path specified");
        return;

    }

    inputFilePath = process.argv[2];





    await prepareEnvironment(renditions);

    try {
        cmd_6sec = prepare6secSegmentsCMD(inputFilePath, renditions, "aac", "h264", 24 * 6, 24 * 6);
        cmd_5sec = prepare5secSegmentsCMD(inputFilePath, renditions, "aac", "h264", 24 * 5);
    } catch (e) {
        console.log("Error: ", e);
        return;
    }



    console.log('Creating Multi bit rate segments for 6 seconds rendition...');
    var proc6 = exec(cmd_6sec);

    proc6.stdout.on('data', function(data) {
        console.log("[6 Seconds Renditions]", data);
    });

    proc6.stderr.setEncoding("utf8")
    proc6.stderr.on('data', function(data) {
        console.log("[6 Seconds Renditions]", data);
    });

    proc6.on('close', function() {
        console.log("[6 Seconds Renditions] Finished creating segments for 6 seconds rendition");

        console.log("Creating master playlist:  master_6sec.m3u8");
        fs.writeFile('hls_assets/master_6sec.m3u8', masterManifest6sec, (err) => {
            if (err) {

                console.log("Error while creating master_6sec.m3u8", err.message);
            }
        });
        console.log("Created Master playlist(master_6sec.m3U8) successfully");

    });



    console.log('Creating Multi bit rate segments for 5 seconds rendition...');
    var proc5 = exec(cmd_5sec);

    proc5.stdout.on('data', function(data) {
        console.log("[5 Seconds Renditions]", data);
    });

    proc5.stderr.setEncoding("utf8")
    proc5.stderr.on('err', function(data) {
        console.log("[5 Seconds Renditions]", data);
    });

    proc5.on('close', function() {
        console.log("[5 Seconds Renditions] Finished creating segments for 5 seconds rendition");

        console.log("Creating master playlist:  master_5sec.m3u8");

        fs.writeFile('hls_assets/master_5sec.m3u8', masterManifest5sec, (err) => {
            if (err) {

                console.log("Error while creating master_5sec.m3u8", err.message);
            }
        });
        console.log("Created Master playlist(master_5sec.m3U8) successfully");
    });


}

run();





































async function createHLSSegments(inputFilePath, args) {

    const { stdout, stderr } = await exec(`
    ${ffmpegPath} -hide_banner -y -i ${inputFilePath} ${args}`);
    if (stderr) console.error(stderr);

}

async function make6SecSegmentHLS(renditionsArray) {

    prepareEnvironment(renditions);

    let args = "";

    for (let rendition of renditionsArray) {

        let renditionDir = `./hls_assets/segment_6/${rendition.name}`;

        args =
            `-hide_banner -y -loglevel quiet -stats -vf scale=w=${rendition.resolution_width}:h=${rendition.resolution_height}\
         -c:a aac -ar 48000 -c:v h264 -profile:v main -crf 20 -sc_threshold 0 -g ${24*6} -keyint_min ${24*6} -hls_time 6 \
         -hls_playlist_type vod  -b:v ${rendition.bitrate}k -maxrate ${rendition.bitrate*max_bitrate_ratio}k \
         -bufsize ${rendition.bitrate*rate_monitor_buffer_ratio}k -b:a ${rendition.audio_bitrate}k -r ${rendition.frame_rate}\
          -hls_segment_filename ${renditionDir}/${rendition.name}_%03d.ts ${renditionDir}/${rendition.name}.m3u8`;

        console.log(`Creating segment of ${rendition.resolution_width}X${rendition.resolution_height} resolution, ${rendition.frame_rate} frame rate and ${rendition.bitrate}k bitrate`);
        try {
            await createHLSSegments('tos-teaser.mp4', args);

        } catch (e) {
            console.log("Error : ", e);
        }
        console.log("Segments created");
        masterManifest += `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bitrate*1000},AVERAGE-BANDWIDTH=${rendition.bitrate*1000},RESOLUTION=${rendition.resolution_width}X${rendition.resolution_height},CODECS="aac,h264",FRAME-RATE=${rendition.frame_rate}\n${renditionDir}/${rendition.name}.m3u8\n`;
    }
    console.log("Creating master playlist:  master_6sec.m3u8");
    fs.writeFileSync('hls_assets/master_6sec.m3u8', masterManifest);
    console.log("Created Master playlist(master.m3U8) successfully");

}

// make6SecSegmentHLS(renditions);







// async function run() {
//     const { stdout } = await exec(`
//     ${ffmpegPath} -hide_banner -i tos-teaser.mp4 \
//   -vf scale=w=640:h=360 -c:a aac -ar 48000 -c:v h264 -profile:v main -crf 20 -sc_threshold 0 -g 48 -keyint_min 48 -hls_time 4 -hls_playlist_type vod  -b:v 800k -maxrate 856k -bufsize 1200k -b:a 96k -hls_segment_filename video/360p_%03d.ts video/360p.m3u8 \
//   -vf scale=w=842:h=480 -c:a aac -ar 48000 -c:v h264 -profile:v main -crf 20 -sc_threshold 0 -g 48 -keyint_min 48 -hls_time 4 -hls_playlist_type vod -b:v 1400k -maxrate 1498k -bufsize 2100k -b:a 128k -hls_segment_filename video/480p_%03d.ts video/480p.m3u8 \
//   -vf scale=w=1280:h=720 -c:a aac -ar 48000 -c:v h264 -profile:v main -crf 20 -sc_threshold 0 -g 48 -keyint_min 48 -hls_time 4 -hls_playlist_type vod -b:v 2800k -maxrate 2996k -bufsize 4200k -b:a 128k -hls_segment_filename video/720p_%03d.ts video/720p.m3u8 \
//   -vf scale=w=1920:h=1080 -c:a aac -ar 48000 -c:v h264 -profile:v main -crf 20 -sc_threshold 0 -g 48 -keyint_min 48 -hls_time 4 -hls_playlist_type vod -b:v 5000k -maxrate 5350k -bufsize 7500k -b:a 192k -hls_segment_filename video/1080p_%03d.ts video/1080p.m3u8
//     `);
//     console.log(stdout);
// }



// function createHLSSegments(fileInputPath, name, resolutionWidth, resolutionHeight,
//     bitrate, audioBitrate, audioCodec, videoCodec, maxKeyFrame, minKeyFrame, segmentDuration, outputFilePath) {

//     console.log(`--------Starting transcoding for ${name}----------`)
//     ffmpeg(fileInputPath).addOptions([
//             `-vf scale=w=${resolutionWidth}:h=${resolutionHeight}`,
//             `-c:a ${audioCodec}`,
//             `-b:a ${audioBitrate}k`,
//             `-c:v ${videoCodec}`,
//             `-b:v ${bitrate}k`,
//             `-maxrate ${bitrate*max_bitrate_ratio}k`,
//             `-bufsize ${bitrate*rate_monitor_buffer_ratio}k`,
//             '-profile:v main',
//             `-g ${maxKeyFrame}`,
//             `-keyint_min ${minKeyFrame}`,
//             '-sc_threshold 0',
//             `-hls_time ${segmentDuration}`,
//             '-hls_playlist_type vod',
//             `-hls_segment_filename video/${name}_%03d.ts`
//         ]).output(outputFilePath)
//         .on('error', (err) => {
//             console.log("An error occured : ", err);
//         })
//         .on('end', (err) => console.log("--------Finshed transcoding----------\n\n"))
//         .run();

// }


// function make6SecSegmentHLS() {

//     console.log("6 SECONDS SEGEMENT HLS");


//     for (let rendition of renditions) {

//         createHLSSegments(
//             'tos-teaser.mp4', rendition.name, rendition.resolutionHeight, rendition.resolutionWidth,
//             rendition.bitrate, rendition.audio_bitrate, 'aac', 'h264', 6 * rendition.frame_rate, 6 * rendition.frame_rate, 6, `video/${rendition.name}.m3u8`);

//         masterManifest += `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bitrate*1000},AVERAGE-BANDWIDTH=${rendition.bitrate*1000},RESOLUTION=${rendition.resolution_height}X${rendition.resolution_width},CODECS="aac,h264",FRAME-RATE=${rendition.frame_rate}\n${rendition.name}.m3u8\n`
//     }

//     fs.writeFile('video/master.m3u8', masterManifest, function(err) {
//         if (err) return console.log(err);
//         console.log('Created master playlist');
//     });

// }