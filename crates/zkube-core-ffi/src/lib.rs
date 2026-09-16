//! C ABI for the native client. The shared safe boundary owns engine encoding.

/// Identifies the native calling convention independently of core versioning.
#[unsafe(no_mangle)]
pub extern "C" fn zkube_core_abi_version() -> u32 {
    u32::from(zkube_core_host::native::ABI_VERSION)
}

fn address_range(pointer: usize, length: usize) -> Option<std::ops::Range<usize>> {
    if pointer == 0 || length > isize::MAX as usize {
        return None;
    }
    Some(pointer..pointer.checked_add(length)?)
}

fn overlap(a: &std::ops::Range<usize>, b: &std::ops::Range<usize>) -> bool {
    a.start < b.end && b.start < a.end
}

/// Invoke one operation from the generated ABI registry. All fields are
/// little-endian. The request begins with the u16 ABI version.
///
/// Every failure leaves response bytes and `response_written` untouched.
/// No pointer is retained; outputs become visible only after complete success.
///
/// # Safety
/// Request must reference `request_len` readable initialized bytes. Response
/// must reference `response_capacity` writable bytes.
/// `response_written` must reference an aligned writable u32. Those ranges
/// must not overlap or be accessed concurrently. Null/range/alignment checks
/// cannot establish whether non-null caller memory is actually mapped.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zkube_core_call(
    operation: u32,
    request: *const u8,
    request_len: u32,
    response: *mut u8,
    response_capacity: u32,
    response_written: *mut u32,
) -> i32 {
    std::panic::catch_unwind(|| {
        use zkube_core_host::native::{MAX_REQUEST_BYTES, dispatch};
        if request_len as usize > MAX_REQUEST_BYTES {
            return 2;
        }
        let Some(input_range) = address_range(request as usize, request_len as usize) else {
            return 1;
        };
        let Some(written_range) = address_range(response_written as usize, size_of::<u32>()) else {
            return 1;
        };
        if (response_written as usize) % align_of::<u32>() != 0
            || overlap(&input_range, &written_range)
        {
            return 1;
        }
        let Some(output_range) = address_range(response as usize, response_capacity as usize)
        else {
            return 1;
        };
        if overlap(&input_range, &output_range) || overlap(&written_range, &output_range) {
            return 1;
        }
        // SAFETY: caller promises readable memory; null, bounded length,
        // address overflow and output aliasing were checked above.
        let input = unsafe { std::slice::from_raw_parts(request, request_len as usize) };
        let output = match dispatch(operation, input) {
            Ok(v) => v,
            Err(status) => return status,
        };
        let Ok(length) = u32::try_from(output.len()) else {
            return 104;
        };
        if response_capacity < length {
            return 5;
        }
        // SAFETY: caller promises writable memory, capacity and disjoint
        // ranges were checked; output is a separately owned allocation.
        unsafe {
            std::ptr::copy_nonoverlapping(output.as_ptr(), response, output.len());
        }
        // SAFETY: caller promises writable u32; alignment/range/aliasing were
        // checked. This and the copy above are the only output publication.
        unsafe {
            response_written.write(length);
        }
        0
    })
    .unwrap_or(7)
}

#[cfg(test)]
mod tests {
    use super::*;
    use zkube_core_host::native;

    #[test]
    fn rejected_calls_publish_nothing() {
        let request = [u8::try_from(native::ABI_VERSION).unwrap(), 0, 42, 0, 0, 0];
        let expected = native::dispatch(12, &request).unwrap();
        let response_length = native::fields_len(native::DAILY_FIELDS);
        assert_eq!(expected.len(), response_length);
        let mut output = vec![0xa5; response_length + 1];
        let capacity = u32::try_from(output.len()).unwrap();
        let mut written = 0xface;
        // SAFETY: all buffers are live, initialized, disjoint and correctly sized.
        let status = unsafe {
            zkube_core_call(
                12,
                request.as_ptr(),
                6,
                output.as_mut_ptr(),
                u32::try_from(response_length - 1).unwrap(),
                &raw mut written,
            )
        };
        assert_eq!(status, 5);
        assert_eq!(output, vec![0xa5; response_length + 1]);
        assert_eq!(written, 0xface);
        // SAFETY: null output is rejected before any output is published.
        assert_eq!(
            unsafe {
                zkube_core_call(
                    12,
                    request.as_ptr(),
                    6,
                    std::ptr::null_mut(),
                    0,
                    &raw mut written,
                )
            },
            1
        );
        assert_eq!(written, 0xface);
        // SAFETY: disjoint live buffers with sufficient capacity.
        assert_eq!(
            unsafe {
                zkube_core_call(
                    12,
                    request.as_ptr(),
                    6,
                    output.as_mut_ptr(),
                    capacity,
                    &raw mut written,
                )
            },
            0
        );
        assert_eq!(&output[..response_length], expected);
        assert_eq!(&output[response_length..], &[0xa5]);
    }

    #[test]
    fn nulls_aliasing_versions_and_lengths_are_rejected() {
        let version = u8::try_from(native::ABI_VERSION).unwrap();
        let mut input = [version, 0, 42, 0, 0, 0, 0, 0];
        let mut output = [0xa5; 32];
        let mut written = 99;
        // SAFETY: intentionally invalid null rejected before dereference.
        assert_eq!(
            unsafe {
                zkube_core_call(
                    12,
                    std::ptr::null(),
                    6,
                    std::ptr::null_mut(),
                    0,
                    &raw mut written,
                )
            },
            1
        );
        // SAFETY: live overlapping buffers exercise validation; no references
        // to their bytes exist during the call and no write is permitted.
        assert_eq!(
            unsafe {
                zkube_core_call(
                    12,
                    input.as_ptr(),
                    6,
                    input.as_mut_ptr(),
                    8,
                    &raw mut written,
                )
            },
            1
        );
        input[0] = version + 1;
        // SAFETY: disjoint live input/output/written buffers.
        assert_eq!(
            unsafe {
                zkube_core_call(
                    12,
                    input.as_ptr(),
                    6,
                    output.as_mut_ptr(),
                    32,
                    &raw mut written,
                )
            },
            3
        );
        input[0] = version;
        // SAFETY: an oversized length is rejected before forming the input slice.
        assert_eq!(
            unsafe {
                zkube_core_call(
                    12,
                    input.as_ptr(),
                    u32::MAX,
                    output.as_mut_ptr(),
                    32,
                    &raw mut written,
                )
            },
            2
        );
        // SAFETY: disjoint live input/output/written buffers.
        assert_eq!(
            unsafe {
                zkube_core_call(
                    12,
                    input.as_ptr(),
                    5,
                    output.as_mut_ptr(),
                    32,
                    &raw mut written,
                )
            },
            2
        );
        assert_eq!(written, 99);
        assert_eq!(output, [0xa5; 32]);
    }
}
