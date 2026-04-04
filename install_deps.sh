#!/bin/bash
echo "Installing required packages for new features..."

# Core dependencies
npm install fluent-ffmpeg
npm install @distube/ytdl-core

# System dependency
pkg install ffmpeg -y

echo "✅ All dependencies installed!"
echo ""
echo "New commands available:"
echo "• .ocr (fixed) - Extract text from images"
echo "• .imagine <prompt> - Generate AI images"
echo "• .imaginefast <prompt> - Fast image generation"
echo "• .imagineanime <prompt> - Anime style images"
echo "• .imaginereal <prompt> - Photorealistic images"
echo "• .playvn <song> - Download music as voice note"
echo "• .toaudio - Extract audio from video (voice note)"
echo "• .tomp3 - Extract audio from video (MP3 file)"
