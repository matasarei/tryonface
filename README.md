# Eyewear virtual try
Simple video-based eyewear virtual try on (HTML5 demo).

Powered by:
* three.js (r54) http://threejs.org/
* clmtrack https://github.com/auduno/clmtrackr

![screen](https://cloud.githubusercontent.com/assets/6638367/5941609/cd68db14-a71a-11e4-8d1c-67040e522287.jpg)

## Known issues
* Starting with Chrome 47, getUserMedia() requests are only allowed from secure origins: HTTPS or localhost;
* Access to images via `file://` may be blocked by CORS, use webserver with `http://localhost` to test the demo instead;
* May be incompatible with some browsers. Tested with Chrome 75, Opera 60, Firefox 76.

## Live examples
* https://hcnotes.in.ua/tryonface/
