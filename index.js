const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; //package for using the right binary of ffmpeg on each OS
const ffmpeg = require('fluent-ffmpeg'); //package for getting the video metadata
const fs = require('fs');
const util = require('util');
const exec = require('child_process').exec;
const execSync = util.promisify(exec);
const ffprobeSync = util.promisify(ffmpeg.ffprobe);

ffmpeg.setFfmpegPath(ffmpegPath);

//Didnt use fluent-ffmpeg for the transcoding cause it turns out calling the command is a lot easier
//fluent-ffmpeg ran into errors involving child processes.
//Another consideration would be looking for ways to make this run faster....maybe running more processes for multi core systems


let inputFilePath = "";
let videoCodec;
let audioCodec;
let audioSampleRate;



let masterManifest6sec = "#EXTM3U\n"; //Master manifest variable for 6 seconds rendition
let masterManifest5sec = "#EXTM3U\n"; //Master manifest variable for 5 seconds rendition


const renditions = [
    { name: "1080p_60", resolution_width: 1920, resolution_height: 1080, bitrate: 6000, audio_bitrate: 192, frame_rate: 60 },
    { name: "1080p", resolution_width: 1920, resolution_height: 1080, bitrate: 5000, audio_bitrate: 192, frame_rate: 24 },
    { name: "720p", resolution_width: 1280, resolution_height: 720, bitrate: 3200, audio_bitrate: 128, frame_rate: 24 },
    { name: "480p", resolution_width: 854, resolution_height: 480, bitrate: 1600, audio_bitrate: 128, frame_rate: 24 },
    { name: "360p", resolution_width: 640, resolution_height: 360, bitrate: 1100, audio_bitrate: 128, frame_rate: 24 }
];

const max_bitrate_ratio = 1.07 // maximum accepted bitrate fluctuations
const rate_monitor_buffer_ratio = 1.5 // maximum buffer size between bitrate conformance checks



//prepareEnvironment function installs the dependency (@ffmpeg-installer/ffmpeg) 
//and creates the needed directories to store the outoput files
async function prepareEnvironment(renditionsArray) {
    console.log("Preparing transcoding environment");

    if (process.argv.length < 3) {
        console.log("No input file path specified");
        return;

    }

    inputFilePath = process.argv[2];


    console.log("Installing ffmpeg packages");

    try {
        await execSync(`npm install`);
    } catch (e) {
        console.log("Error: ", e);
        return;
    }

    console.log("Installation complete");


    // Synchronous because we need the media metadata for further work
    let { streams } = await ffprobeSync(inputFilePath);
    let videoMetadata;
    let audioMetadata;

    console.log(streams);

    streams.forEach(function(stream) {
        if (stream.codec_type === "video")
            videoMetadata = stream;
        else if (stream.codec_type === "audio")
            audioMetadata = stream
    });

    videoCodec = videoMetadata['codec_name'];
    audioCodec = audioMetadata['codec_name'];
    audioSampleRate = audioMetadata['sample_rate'];


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


//prepare6secSegmentsCMD function agreggates the commands for each resolution/bitrate for the 6 seconds segments into one command
// Command outputs are surpressed, except for the frame information
function prepare6secSegmentsCMD(inputFilePath, renditionsArray, audioCodec, videoCodec, audioSampleRate) {

    let durationString = "segment_6";
    let assetFolder = "hls_assets";

    let cmd = `${ffmpegPath} -i ${inputFilePath} -hide_banner -y -loglevel quiet -stats `;

    for (let rendition of renditionsArray) {

        let renditionDir = `./${assetFolder}/${durationString}/${rendition.name}`;

        cmd +=
            `-vf scale=w=${rendition.resolution_width}:h=${rendition.resolution_height}\
     -c:a ${audioCodec} -ar ${audioSampleRate} -c:v ${videoCodec} -profile:v main -crf 20 -sc_threshold 0 -g ${rendition.frame_rate*6}\
      -keyint_min ${rendition.frame_rate*6} -hls_time 6 -hls_playlist_type vod  -b:v ${rendition.bitrate}k \
      -maxrate ${rendition.bitrate*max_bitrate_ratio}k -bufsize ${rendition.bitrate*rate_monitor_buffer_ratio}k \
      -b:a ${rendition.audio_bitrate}k -r ${rendition.frame_rate}\
      -hls_segment_filename ${renditionDir}/${rendition.name}_%03d.ts ${renditionDir}/${rendition.name}.m3u8 `;


        masterManifest6sec += `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bitrate*1000},AVERAGE-BANDWIDTH=${rendition.bitrate*1000},RESOLUTION=${rendition.resolution_width}X${rendition.resolution_height},CODECS="aac,h264",FRAME-RATE=${rendition.frame_rate}\n${durationString}/${rendition.name}/${rendition.name}.m3u8\n`;
    }

    return cmd;

}


//prepare5secSegmentsCMD function agreggates the commands for each resolution/bitrate for the 5 seconds segments into one command
// Command outputs are surpressed, except for the frame information
function prepare5secSegmentsCMD(inputFilePath, renditionsArray, audioCodec, videoCodec, audioSampleRate) {

    let durationString = "segment_5";
    let assetFolder = "hls_assets";

    let cmd = `${ffmpegPath} -i ${inputFilePath} -hide_banner -y -loglevel quiet -stats `;

    for (let rendition of renditionsArray) {
        let renditionDir = `./${assetFolder}/${durationString}/${rendition.name}`;

        cmd +=
            `-vf scale=w=${rendition.resolution_width}:h=${rendition.resolution_height}\
 -c:a ${audioCodec} -ar ${audioSampleRate} -c:v ${videoCodec} -profile:v main -crf 20 -sc_threshold 0 \
  -keyint_min ${rendition.frame_rate*5} -hls_time 5 -hls_playlist_type vod  -b:v ${rendition.bitrate}k \
  -maxrate ${rendition.bitrate*max_bitrate_ratio}k -bufsize ${rendition.bitrate*rate_monitor_buffer_ratio}k \
  -b:a ${rendition.audio_bitrate}k -r ${rendition.frame_rate}\
  -hls_segment_filename ${renditionDir}/${rendition.name}_%03d.ts ${renditionDir}/${rendition.name}.m3u8 `;

        masterManifest5sec += `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bitrate*1000},AVERAGE-BANDWIDTH=${rendition.bitrate*1000},RESOLUTION=${rendition.resolution_width}X${rendition.resolution_height},CODECS="aac,h264",FRAME-RATE=${rendition.frame_rate}\n${durationString}/${rendition.name}/${rendition.name}.m3u8\n`;

    }

    cmd +=
        `-c:a ${audioCodec} -ar 48000 -vn -hls_time 5 -hls_playlist_type vod -b:a 192k -keyint_min ${24*5} \
     -hls_segment_filename ./${assetFolder}/${durationString}/audio/audio_%03d.ts ./${assetFolder}/${durationString}/audio/audio.m3u8 `;

    masterManifest5sec += `#EXT-X-STREAM-INF:BANDWIDTH=192000,AVERAGE-BANDWIDTH=192000,CODECS="aac"\n${durationString}/audio/audio.m3u8\n`;

    return cmd;

}

// run function fires the entire program. 
// It runs the 6 seconds segments and 5 seconds segments transcoding in 2 seperate shell processes side by side
// We could also run the processes synchronously...might make console output clearer and each execution more explicit
async function run() {

    var cmd_6sec = "";
    var cmd_5sec = "";


    await prepareEnvironment(renditions);

    try {
        cmd_6sec = prepare6secSegmentsCMD(inputFilePath, renditions, audioCodec, videoCodec, audioSampleRate);
        cmd_5sec = prepare5secSegmentsCMD(inputFilePath, renditions, audioCodec, videoCodec, audioSampleRate);
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