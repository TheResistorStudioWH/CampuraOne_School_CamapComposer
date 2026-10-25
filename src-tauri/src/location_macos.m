#import <Foundation/Foundation.h>
#import <CoreLocation/CoreLocation.h>

typedef bool (*CamapCancelled)(uintptr_t);
typedef void (*CamapCompletion)(uintptr_t, int32_t, double, double, double);

@interface CamapLocationRequest : NSObject <CLLocationManagerDelegate>
@property(nonatomic, strong) CLLocationManager *manager;
@property(nonatomic, strong) NSTimer *timer;
@property(nonatomic, strong) NSDate *started;
@property(nonatomic) uintptr_t context;
@property(nonatomic) CamapCancelled cancelled;
@property(nonatomic) CamapCompletion completion;
- (void)finish:(int32_t)code location:(CLLocation *)location;
@end

@implementation CamapLocationRequest
- (void)finish:(int32_t)code location:(CLLocation *)location {
    if (!self.completion) return;
    CamapCompletion completion = self.completion;
    uintptr_t context = self.context;
    self.completion = NULL;
    [self.manager stopUpdatingLocation];
    self.manager.delegate = nil;
    [self.timer invalidate];
    self.timer = nil;
    completion(context, code, location ? location.coordinate.longitude : 0,
               location ? location.coordinate.latitude : 0, location ? location.horizontalAccuracy : 0);
}
- (void)startUpdatesIfAllowed {
    if (!self.completion) return;
    CLAuthorizationStatus status = self.manager.authorizationStatus;
    if (status == kCLAuthorizationStatusDenied || status == kCLAuthorizationStatusRestricted) {
        [self finish:1 location:nil];
    } else if (status != kCLAuthorizationStatusNotDetermined) {
        [self.manager startUpdatingLocation];
    }
}
- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager {
    [self startUpdatesIfAllowed];
}
- (void)locationManager:(CLLocationManager *)manager didUpdateLocations:(NSArray<CLLocation *> *)locations {
    if (!self.completion) return;
    if (self.cancelled(self.context)) { [self finish:3 location:nil]; return; }
    CLLocation *location = locations.lastObject;
    // Reject stale cached fixes and invalid accuracy. Core Location coordinates are WGS-84.
    if (location && location.horizontalAccuracy >= 0 &&
        fabs(location.timestamp.timeIntervalSinceNow) <= 30) {
        [self finish:0 location:location];
    }
}
- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error {
    if (error.code == kCLErrorLocationUnknown) return; // transient; keep waiting within the deadline
    [self finish:(error.code == kCLErrorDenied ? 1 : 4) location:nil];
}
@end

// Called on Tauri's main thread so Core Location can deliver delegate callbacks and consent UI.
void camap_locate(uintptr_t context, CamapCancelled cancelled, CamapCompletion completion) {
    CamapLocationRequest *request = [CamapLocationRequest new];
    request.context = context;
    request.cancelled = cancelled;
    request.completion = completion;
    if (cancelled(context)) { [request finish:3 location:nil]; return; }
    request.manager = [CLLocationManager new];
    request.manager.delegate = request;
    // A Mac often has no GPS receiver; a Wi-Fi fix is sufficient to find a campus.
    request.manager.desiredAccuracy = kCLLocationAccuracyHundredMeters;
    request.started = [NSDate date];
    // The timer retains this request until completion; finish invalidates it to break the cycle.
    request.timer = [NSTimer timerWithTimeInterval:0.25 repeats:YES block:^(NSTimer *timer __attribute__((unused))) {
        if (!request.completion) return;
        if (request.cancelled(request.context)) [request finish:3 location:nil];
        else if (-request.started.timeIntervalSinceNow >= 45) [request finish:2 location:nil];
    }];
    [[NSRunLoop mainRunLoop] addTimer:request.timer forMode:NSRunLoopCommonModes];
    if (![CLLocationManager locationServicesEnabled]) {
        [request finish:1 location:nil];
    } else if (request.manager.authorizationStatus == kCLAuthorizationStatusNotDetermined) {
        [request.manager requestWhenInUseAuthorization];
    } else {
        [request startUpdatesIfAllowed];
    }
}
