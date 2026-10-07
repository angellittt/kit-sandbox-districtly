import { useCallback, useMemo, useState } from "react";

export interface UseDisclosureReturn {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
  onToggle: () => void;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Custom hook for handling disclosure (open/close) state with utility functions.
 * @param {boolean} [initialState] - The initial value for the disclosure state (default is `false`).
 * @returns {UseDisclosureReturn} An object containing the disclosure state and utility functions to manipulate the state.
 * @property {boolean} isOpen - The current disclosure state value.
 * @property {Function} onOpen - Function to set the disclosure state to `true` (open).
 * @property {Function} onClose - Function to set the disclosure state to `false` (close).
 * @property {Function} onToggle - Function to toggle the disclosure state.
 * @property {Function} setIsOpen - Function to set the disclosure state directly.
 * @example
 * const { isOpen, onOpen, onClose, onToggle } = useDisclosure();
 *
 * console.log(isOpen); // false
 * onOpen();
 * console.log(isOpen); // true
 * onToggle();
 * console.log(isOpen); // false
 */
const useDisclosure = (initialState: boolean = false): UseDisclosureReturn => {
  const [isOpen, setIsOpen] = useState<boolean>(initialState);
  const onClose = useCallback(() => {
    setIsOpen(false);
  }, [setIsOpen]);

  const onOpen = useCallback(() => {
    setIsOpen(true);
  }, [setIsOpen]);

  const onToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, [setIsOpen]);

  return useMemo(
    () => ({ isOpen, onClose, onOpen, onToggle, setIsOpen }),
    [isOpen, onClose, onOpen, onToggle, setIsOpen],
  );
};

export default useDisclosure;
