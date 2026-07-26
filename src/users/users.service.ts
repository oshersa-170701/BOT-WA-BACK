import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async create(createUserDto: CreateUserDto) {
    const existingUser = await this.userRepository.findOneBy({ email: createUserDto.email });
    if (existingUser) {
      throw new ConflictException('El correo electrónico ya está registrado');
    }

    // Guardamos la contraseña sin encriptar
    const user = this.userRepository.create(createUserDto);
    return await this.userRepository.save(user);
  }

  async findAll() {
    return await this.userRepository.find();
  }

  async findOne(id: number) {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
    }
    return user;
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    await this.findOne(id);
    await this.userRepository.update(id, updateUserDto);
    return await this.findOne(id);
  }

  async remove(id: number) {
    const user = await this.findOne(id);
    return await this.userRepository.remove(user);
  }
  async login(email: string, pass: string) {
  const user = await this.userRepository.findOneBy({ email });
  if (!user || user.password !== pass) {
    throw new NotFoundException('Credenciales inválidas');
  }
  return { success: true, message: 'Login exitoso', user };
}
}