import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input, type InputProps } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function PasswordField(props: InputProps) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input type={visible ? 'text' : 'password'} className="pr-11" {...props} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-[3px] top-[3px] h-[38px] w-[38px] text-muted-foreground"
        aria-label={visible ? 'Hide password' : 'Show password'}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </Button>
    </div>
  )
}
