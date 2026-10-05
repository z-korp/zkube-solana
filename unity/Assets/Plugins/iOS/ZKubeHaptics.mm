#import <CoreHaptics/CoreHaptics.h>
#import <UIKit/UIKit.h>

// The board's haptics on iPhone, where Handheld.Vibrate is a long buzz: a light Taptic tap for a move
// and a short, weak continuous buzz for a line break.
extern "C" void zkube_haptic_tap(void)
{
    static UIImpactFeedbackGenerator *generator;
    if (!generator) generator = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleLight];
    [generator impactOccurred];
}

extern "C" void zkube_haptic_buzz(float seconds, float intensity)
{
    static CHHapticEngine *engine;
    if (!CHHapticEngine.capabilitiesForHardware.supportsHaptics) return;
    if (!engine)
    {
        engine = [[CHHapticEngine alloc] initAndReturnError:nil];
        engine.playsHapticsOnly = YES;
        engine.autoShutdownEnabled = YES;
    }
    // Starting again restarts an engine the system stopped, such as after the app was in the background.
    if (![engine startAndReturnError:nil]) return;
    CHHapticEvent *buzz = [[CHHapticEvent alloc] initWithEventType:CHHapticEventTypeHapticContinuous parameters:@[
        [[CHHapticEventParameter alloc] initWithParameterID:CHHapticEventParameterIDHapticIntensity value:intensity],
        [[CHHapticEventParameter alloc] initWithParameterID:CHHapticEventParameterIDHapticSharpness value:0.3f]]
        relativeTime:0 duration:seconds];
    CHHapticPattern *pattern = [[CHHapticPattern alloc] initWithEvents:@[buzz] parameters:@[] error:nil];
    [[engine createPlayerWithPattern:pattern error:nil] startAtTime:CHHapticTimeImmediate error:nil];
}
