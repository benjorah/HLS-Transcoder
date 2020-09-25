## About this project

- This project contains a script that transcodes an input video file into HLS segments of different bitrates and resolutions
- Make sure to have Nodejs installed
- To run this project, run the command in the project folder : `node . [path to video file]`
- You can test the output files using the *ffplay* from ffmpeg e.g `ffplay hls_asset/master_6sec.m3u8` 