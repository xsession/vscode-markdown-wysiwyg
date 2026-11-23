# Status LED driver

The status LED shows the controller state at a glance. It is driven by a single GPIO pin and blinks with a **pattern per state**, so that a field engineer can read it without a debugger.

## Signals

| Signal | Pin | Direction | Notes |
| --- | --- | --- | --- |
| LED | 13 | out | active high |
| Button | 2 | in | internal pull-up |

## Blink patterns

1. **Idle**: one short blink every two seconds.
2. **Capture**: steady on.
3. **Fault**: three fast blinks, then a pause.

```c
void led_set(enum led_state state) {
    timer_stop(&led_timer);
    led_timer.pattern = patterns[state];
    timer_start(&led_timer);
}
```

> The pattern table lives in flash; changing it needs a firmware update.
