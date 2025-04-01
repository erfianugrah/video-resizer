# Client Detection

This directory contains documentation for client detection features in Video Resizer.

## What is Client Detection?

Client detection allows Video Resizer to intelligently adapt video delivery based on the requesting client's capabilities, network conditions, and preferences. This improves the viewer experience by optimizing video quality, format, and other parameters for each viewer's specific situation.

## Documentation

- [Client Detection Improvements](./CLIENT_DETECTION_IMPROVEMENT.md)

## Implementation Details

The client detection system includes:
- Modern feature detection using Client Hints and browser compatibility data
- Network quality assessment and adaptation
- Device capability detection (codecs, screen size, HDR support)
- Battery status awareness for mobile devices
- Fallback mechanisms for older browsers
- Configuration options for fine-tuning detection behavior